import type {
  OperatorNotificationResponse,
  OperatorNotificationsResponse,
} from "../../contracts/api.js";

export function createOperatorNotificationsResponse(
  notifications: OperatorNotificationResponse[],
  generatedAt = new Date().toISOString(),
): OperatorNotificationsResponse {
  return {
    notifications,
    summary: {
      generatedAt,
      total: notifications.length,
      critical: notifications.filter((notification) => notification.severity === "critical").length,
      warning: notifications.filter((notification) => notification.severity === "warning").length,
      info: notifications.filter((notification) => notification.severity === "info").length,
    },
  };
}
