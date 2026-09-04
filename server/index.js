require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Android SMS Gateway config (from .env)
// The gateway runs on your Android phone — same Wi-Fi network required.
// ---------------------------------------------------------------------------
const SMS_GATEWAY_URL = process.env.SMS_GATEWAY_URL; // e.g. http://192.168.1.5:8080
const SMS_GATEWAY_USER = process.env.SMS_GATEWAY_USER || "admin";
const SMS_GATEWAY_PASS = process.env.SMS_GATEWAY_PASS;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "WalkSafe server is running 🚀" });
});

// ---------------------------------------------------------------------------
// Phone number normaliser — converts to E.164 format
// Handles: 10-digit Indian numbers, 0XXXXXXXXXX, +91XXXXXXXXXX, already E.164
// ---------------------------------------------------------------------------
const normalizePhone = (raw) => {
  let phone = String(raw || "").replace(/[\s\-().]/g, "");

  if (!phone) return null;

  // Already in E.164 format
  if (phone.startsWith("+")) return phone;

  // Starts with 0 (Indian STD trunk prefix)
  if (phone.startsWith("0")) phone = phone.slice(1);

  // 10-digit Indian number
  if (/^\d{10}$/.test(phone)) return `+91${phone}`;

  // 12-digit starting with 91
  if (/^91\d{10}$/.test(phone)) return `+${phone}`;

  return `+${phone}`;
};

// ---------------------------------------------------------------------------
// POST /send-sos
//
// Body:
// {
//   "contacts": [{ "name": "Alice", "phone": "+919876543210" }, ...],
//   "location": { "latitude": 12.9716, "longitude": 77.5946 }   // optional
// }
// ---------------------------------------------------------------------------
app.post("/send-sos", async (req, res) => {
  const { contacts, location } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ success: false, error: "No contacts provided." });
  }

  if (!SMS_GATEWAY_URL || !SMS_GATEWAY_PASS) {
    return res.status(500).json({
      success: false,
      error: "SMS Gateway not configured. Set SMS_GATEWAY_URL and SMS_GATEWAY_PASS in .env",
    });
  }

  // Build message body
  let messageBody =
    "🚨 WALKSAFE EMERGENCY ALERT 🚨\n\n" +
    "I may be in danger and need help immediately. " +
    "Please contact me as soon as possible.\n\n";

  if (location?.latitude && location?.longitude) {
    const mapsUrl = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
    messageBody += `📍 My last known location:\n${mapsUrl}\n\n`;
  }

  messageBody += "— Sent automatically via WalkSafe";

  // Build Basic Auth header
  const basicAuth =
    "Basic " +
    Buffer.from(`${SMS_GATEWAY_USER}:${SMS_GATEWAY_PASS}`).toString("base64");

  // Fire one SMS per contact concurrently via Android SMS Gateway
  const sendPromises = contacts.map(async (contact) => {
    const phone = normalizePhone(contact.phone);

    if (!phone) {
      return { name: contact.name, phone: contact.phone, status: "failed", error: "Empty phone number" };
    }

    try {
      const response = await fetch(`${SMS_GATEWAY_URL}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: basicAuth,
        },
        body: JSON.stringify({
          textMessage: { text: messageBody },
          phoneNumbers: [phone],
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`[SOS] Sent to ${contact.name} (${phone})`);
        return { name: contact.name, phone, status: "sent" };
      } else {
        console.error(`[SOS] Gateway error for ${contact.name}:`, data);
        return { name: contact.name, phone, status: "failed", error: JSON.stringify(data) };
      }
    } catch (err) {
      console.error(`[SOS] Failed to send to ${contact.name} (${phone}):`, err.message);
      return { name: contact.name, phone, status: "failed", error: err.message };
    }
  });

  const results = await Promise.all(sendPromises);
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(`[SOS] Done — ${sent} sent, ${failed} failed`);

  return res.json({ success: sent > 0, sent, failed, results });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n✅ WalkSafe server running on port ${PORT}`);
  console.log(`   Health check:  http://localhost:${PORT}`);
  console.log(`   SOS endpoint:  POST http://localhost:${PORT}/send-sos`);
  console.log(`   SMS Gateway:   ${SMS_GATEWAY_URL || "⚠️  NOT SET — add SMS_GATEWAY_URL to .env"}\n`);
});
