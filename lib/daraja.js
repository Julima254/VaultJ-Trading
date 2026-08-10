const axios = require("axios");

const BASE_URL =
  process.env.DARAJA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

// Normalize phone to 2547XXXXXXXX / 2541XXXXXXXX format
function formatPhone(phone) {
  let p = String(phone).trim().replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

function getTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return data.access_token;
}

async function stkPush({ phone, amount, accountReference, transactionDesc }) {
  const token = await getAccessToken();
  const timestamp = getTimestamp();
  const shortcode = process.env.DARAJA_SHORTCODE;
  const password = Buffer.from(
    `${shortcode}${process.env.DARAJA_PASSKEY}${timestamp}`
  ).toString("base64");

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: formatPhone(phone),
    PartyB: shortcode,
    PhoneNumber: formatPhone(phone),
    CallBackURL: process.env.DARAJA_CALLBACK_URL,
    AccountReference: accountReference || "VaultJ Deposit",
    TransactionDesc: transactionDesc || "Wallet Deposit",
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
}

async function stkQuery(checkoutRequestId) {
  const token = await getAccessToken();
  const timestamp = getTimestamp();
  const shortcode = process.env.DARAJA_SHORTCODE;
  const password = Buffer.from(
    `${shortcode}${process.env.DARAJA_PASSKEY}${timestamp}`
  ).toString("base64");

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

module.exports = { formatPhone, getAccessToken, stkPush, stkQuery };