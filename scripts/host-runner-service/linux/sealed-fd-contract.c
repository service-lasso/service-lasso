/* Owner-built Linux FD validator. It validates the already held object; no
 * pathname is accepted after the descriptor crosses the trust boundary. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <openssl/sha.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
bool service_lasso_linux_sealed_fd(int fd, const unsigned char expected[SHA256_DIGEST_LENGTH]) {
  struct stat before, after; unsigned char got[SHA256_DIGEST_LENGTH], buf[8192]; SHA256_CTX ctx; ssize_t n;
  int seals = fcntl(fd, F_GET_SEALS);
  if (fd < 0 || seals < 0 || (seals & (F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK|F_SEAL_SEAL)) != (F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK|F_SEAL_SEAL)) return false;
  if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) || before.st_nlink != 0 || lseek(fd, 0, SEEK_SET) < 0) return false;
  SHA256_Init(&ctx); while ((n = read(fd, buf, sizeof buf)) > 0) SHA256_Update(&ctx, buf, (size_t)n);
  if (n < 0 || fstat(fd, &after) != 0 || before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_size != after.st_size) return false;
  SHA256_Final(got, &ctx); return memcmp(got, expected, SHA256_DIGEST_LENGTH) == 0;
}
