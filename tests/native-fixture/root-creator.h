#ifndef SERVICE_LASSO_F7_ROOT_CREATOR_H
#define SERVICE_LASSO_F7_ROOT_CREATOR_H

#ifdef __cplusplus
extern "C" {
#endif

/* Source-private original ownership types. Only the independent original
 * admission owner issues a binding. The creator alone defines owner/capsule.
 * A pointer, plan, packet, signature or native number conveys no authority.
 * This header defines the reviewed receiving ABI; implementation is required
 * and there is deliberately no constructor, reset, destructor or weak stub. */
struct f7_original_root_source_binding;
struct f7_original_attempt_plan;
struct f7_original_root_owner;
struct f7_original_root_capsule;
struct f7_root_retained_failure;
struct f7_observer_owner;
struct f7_observer_begin_record;
struct f7_observer_readiness_record;

enum f7_root_result {
  F7_ROOT_PREPARED = 1,
  F7_ROOT_RETAINED_UNAVAILABLE = 2
};

/* PREPARED is ORIGINAL_OBJECTS_HELD only, never observer/producer startup.
 * Every available partial owner/failure remains retained on unavailability. */
enum f7_root_result f7_root_prepare_original(
    const struct f7_original_root_source_binding *original_binding,
    const struct f7_original_attempt_plan *original_plan,
    struct f7_original_root_owner **retained_owner,
    const struct f7_original_root_capsule **capsule,
    const struct f7_root_retained_failure **failure);

/* Claim the original begin attempt before its single receiving invocation. */
int f7_root_claim_original_observer_begin(
    struct f7_original_root_owner *owner);

/* Retain SAME actual complete/partial owner and original invocation facts. */
int f7_root_retain_original_observer_begin(
    struct f7_original_root_owner *owner,
    struct f7_observer_owner *actual_owner,
    const struct f7_observer_begin_record *actual_invocation);

/* Only original full worker/raw/error/control/SDK live entry can reach READY.
 * BASE_CAPTURE_READY and W preload/view facts do not qualify this record. */
int f7_root_adopt_original_observer_readiness(
    struct f7_original_root_owner *owner,
    const struct f7_observer_readiness_record *actual_readiness);

/* One READY -> ACTIVE transition on SAME owner/capsule; no retry or new O. */
int f7_root_activate_original_capture_entry(
    struct f7_original_root_owner *owner,
    const struct f7_original_root_capsule *capsule);

/* Retain original facts; grants no disposal/reset/delete/privilege action. */
int f7_root_retain_original_facts(struct f7_original_root_owner *owner);

#ifdef __cplusplus
}
#endif

#endif
