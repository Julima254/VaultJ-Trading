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

async function b2cPayment(phone, amount) {
  try {
    const token = await getAccessToken();

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
      {
        InitiatorName: process.env.B2C_INITIATOR_NAME,      // from Daraja portal
        SecurityCredential: process.env.B2C_SECURITY_CRED,  // generated in Safaricom portal
        CommandID: "BusinessPayment",                        // fixed for sending money to customer
        Amount: amount,
        PartyA: process.env.DARAJA_SHORTCODE,               // your business shortcode
        PartyB: phone,                                      // user phone
        Remarks: "VaultJ Withdrawal",
        QueueTimeOutURL: process.env.B2C_TIMEOUT_URL,       // URL for timeout
        ResultURL: process.env.B2C_RESULT_URL,             // URL for callback
        Occasion: "Withdrawal"
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    return response.data;
  } catch (err) {
    console.error("B2C Payment failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { stkPush, b2cPayment };
