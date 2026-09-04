// ---------------------------------------------------------------------------
// Server URL configuration
//
// DEVELOPMENT:  Replace <YOUR_LOCAL_IP> with your machine's LAN IP address.
//               Find it by running `ipconfig` (Windows) and looking for the
//               IPv4 address of your Wi-Fi or Ethernet adapter.
//               Example: 192.168.1.42
//
//               Your phone and PC must be on the same Wi-Fi network.
//
// PRODUCTION:   Once deployed to Render, replace the entire URL with your
//               Render service URL, e.g. https://walksafe-server.onrender.com
// ---------------------------------------------------------------------------

const DEV_SERVER_IP = "10.190.89.240"; // Your PC's LAN IP — phone must be on same Wi-Fi
const DEV_PORT = 3001;

export const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? "https://walksafe-server.onrender.com" // update after Render deploy
    : `http://${DEV_SERVER_IP}:${DEV_PORT}`;

export const SOS_ENDPOINT = `${SERVER_URL}/send-sos`;
