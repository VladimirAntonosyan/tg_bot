const axios = require('axios');
const { randomUUID } = require('crypto');

const SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const RETURN_URL = process.env.YOOKASSA_RETURN_URL || 'https://t.me/fc26avangard_bot';

const API_URL = 'https://api.yookassa.ru/v3';
const AUTH = Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');

if (!SHOP_ID || !SECRET_KEY) {
    console.warn('⚠️ YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY не заданы');
}

async function createPayment(chatId, amount, description) {
    const response = await axios.post(
        `${API_URL}/payments`,
        {
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            capture: true,
            confirmation: { type: 'redirect', return_url: RETURN_URL },
            description: description,
            metadata: { chat_id: String(chatId) }
        },
        {
            headers: {
                'Authorization': `Basic ${AUTH}`,
                'Idempotence-Key': randomUUID(),
                'Content-Type': 'application/json'
            }
        }
    );

    return {
        id: response.data.id,
        confirmationUrl: response.data.confirmation.confirmation_url,
        status: response.data.status
    };
}

async function getPayment(paymentId) {
    const response = await axios.get(
        `${API_URL}/payments/${paymentId}`,
        { headers: { 'Authorization': `Basic ${AUTH}` } }
    );
    return response.data;
}

module.exports = { createPayment, getPayment };