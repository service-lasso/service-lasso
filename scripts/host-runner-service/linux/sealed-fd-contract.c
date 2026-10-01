/* Linux source contract: an owner-built daemon must accept only memfd/O_TMPFILE
 * inputs sealed against write/grow/shrink and retain the descriptor to exit. */
#include <fcntl.h>
#include <stdbool.h>
#include <unistd.h>
bool service_lasso_linux_sealed_fd(int fd) {
  int seals = fcntl(fd, F_GET_SEALS);
  return seals >= 0 && (seals & (F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK)) == (F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK);
}
