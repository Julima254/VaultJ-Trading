const axios = require("axios");
const base64 = require("base-64");
const moment = require("moment");

async function getAccessToken() {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;

  const auth = base64.encode(`${consumerKey}:${consumerSecret}`);

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token;
}

function generatePassword() {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const timestamp = moment().format("YYYYMMDDHHmmss");

  const password = base64.encode(shortcode + passkey + timestamp);

  return { password, timestamp };
}

async function stkPush(phone, amount) {
  const token = await getAccessToken();
  const { password, timestamp } = generatePassword();

  return axios.post(
    "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: process.env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.DARAJA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.DARAJA_CALLBACK_URL,
      AccountReference: "VaultJ Trading",
      TransactionDesc: "VaultJ Deposit"
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
}

module.exports = { stkPush };
