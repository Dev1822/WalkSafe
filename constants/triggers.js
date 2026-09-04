// ---------------------------------------------------------------------------
// Shared trigger configuration — used by both index.jsx and settings.jsx
// ---------------------------------------------------------------------------

export const TRIGGERS_STORAGE_KEY = "walksafe_trigger_settings";

export const DEFAULT_TRIGGERS = {
  shake: false,           // Shake phone 3x rapidly
  notification: false,    // Persistent notification shortcut
  safeWalk: false,        // Auto-send SOS if no check-in before timer ends
  safeWalkMinutes: 30,    // Default safe walk duration in minutes
  flipFaceDown: false,    // Flip screen down 3x rapidly
  rapidTaps: false,       // Tap SOS button 5x rapidly
  tiltSide: false,        // Tilt left-right-left-right
};

// Sensor-based triggers (need accelerometer)
export const SENSOR_TRIGGERS = ["shake", "flipFaceDown", "tiltSide"];
