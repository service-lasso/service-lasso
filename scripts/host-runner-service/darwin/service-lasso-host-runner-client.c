/* Reviewed Darwin Core client for the owner-held host-runner protocol.
 * It selects no object, digest, PID, path, or authority: the daemon owns all
 * expected-object state and authenticates this process from its audit token. */
#include <xpc/xpc.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const char SERVICE[] = "com.service-lasso.host-runner";

int main(int argc, char **argv) {
  if (argc != 1 || geteuid() != 0) return 64;
  xpc_connection_t connection = xpc_connection_create_mach_service(SERVICE, NULL, XPC_CONNECTION_MACH_SERVICE_PRIVILEGED);
  if (connection == NULL) return 65;
  xpc_connection_set_event_handler(connection, ^(xpc_object_t event) { (void)event; });
  xpc_connection_resume(connection);
  xpc_object_t grant = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(grant, "operation", "issue-grant");
  xpc_dictionary_set_uint64(grant, "expires_at_unix", (uint64_t)time(NULL) + 30);
  xpc_object_t grant_reply = xpc_connection_send_message_with_reply_sync(connection, grant);
  xpc_release(grant);
  if (xpc_get_type(grant_reply) != XPC_TYPE_DICTIONARY || !xpc_dictionary_get_bool(grant_reply, "accepted")) { xpc_release(grant_reply); xpc_release(connection); return 66; }
  int capability = xpc_dictionary_dup_fd(grant_reply, "capability_fd");
  size_t nonce_length = 0;
  const uint64_t *nonce = xpc_dictionary_get_data(grant_reply, "capability_nonce", &nonce_length);
  if (capability < 0 || nonce == NULL || nonce_length != sizeof *nonce || write(capability, nonce, sizeof *nonce) != (ssize_t)sizeof *nonce) { if (capability >= 0) close(capability); xpc_release(grant_reply); xpc_release(connection); return 67; }
  xpc_release(grant_reply);
  xpc_object_t completion = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(completion, "operation", "complete");
  xpc_dictionary_set_fd(completion, "capability_fd", capability);
  xpc_object_t completion_reply = xpc_connection_send_message_with_reply_sync(connection, completion);
  close(capability); xpc_release(completion);
  int result = xpc_get_type(completion_reply) == XPC_TYPE_DICTIONARY && xpc_dictionary_get_bool(completion_reply, "accepted") ? 0 : 68;
  xpc_release(completion_reply); xpc_release(connection);
  return result;
}
