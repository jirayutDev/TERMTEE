/**
 * Marker written into ViewSession.deviceId when an admin kicks a viewer.
 * The kicked device's next regular heartbeat no longer matches the session's
 * deviceId, so /api/playback/heartbeat answers 409 and the player stops
 * (simply deleting the row would be undone: the heartbeat recreates a vanished row).
 * The viewer can still reclaim playback (claim=true) unless the ticket is revoked.
 */
export const KICKED_DEVICE_ID = "admin-kicked";
