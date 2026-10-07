#ifndef SERVICE_LASSO_F7_W_ORIGINAL_ENTRY_LINUX_H
#define SERVICE_LASSO_F7_W_ORIGINAL_ENTRY_LINUX_H

#ifdef __cplusplus
extern "C" {
#endif

/* Private original native entry, before the original node::Start call.
 * A result is an actual source-owned gate outcome, never a caller grant.
 * The implementation must retain genuine original custody and readiness;
 * this header provides neither an issuer nor a default/weak implementation. */
enum f7_w_entry_result {
  F7_W_ENTRY_RELEASED = 1,
  F7_W_ENTRY_RETAINED_UNAVAILABLE = 2
};

enum f7_w_entry_result f7_w_original_entry_before_node(int argc, char **argv);

#ifdef __cplusplus
}
#endif

#endif
