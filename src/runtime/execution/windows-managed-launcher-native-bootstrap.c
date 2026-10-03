#define UNICODE
#define _UNICODE
#include <windows.h>
#include <bcrypt.h>
#include <stdio.h>
#include <wchar.h>

#pragma comment(lib, "bcrypt.lib")

/*
 * This is deliberately a native PE boundary.  It runs before a CLR is loaded,
 * removes CLR loader controls, holds the reviewed managed launcher by handle,
 * and only then starts the managed component that owns launch semantics.
 */
#define MANAGED_LAUNCHER_NAME L"windows-managed-launcher-managed.exe"
#define PACKAGE_DIRECTORY_HANDLE_CAPACITY 128
#define MANAGED_LAUNCHER_BYTE_LENGTH 39936LL
static const unsigned char MANAGED_LAUNCHER_SHA256[32] = {
  0xff, 0x1f, 0x7f, 0xdf, 0x44, 0xa4, 0x41, 0x9f,
  0x68, 0x1e, 0x5c, 0xd7, 0xfe, 0x23, 0xbd, 0x59,
  0xb4, 0x95, 0x15, 0x3a, 0xd6, 0x34, 0x2c, 0xcd,
  0x32, 0x1d, 0x2c, 0x36, 0xde, 0x32, 0x28, 0xfa
};

enum {
  BOOTSTRAP_FAILURE_UNKNOWN = 100,
  BOOTSTRAP_FAILURE_BINDING = 124,
  BOOTSTRAP_FAILURE_CREATE = 125,
  BOOTSTRAP_FAILURE_WAIT = 126
};

static int IsLoaderSensitiveName(const wchar_t* name) {
  return _wcsnicmp(name, L"COR_", 4) == 0 ||
    _wcsnicmp(name, L"CORECLR_", 8) == 0 ||
    _wcsnicmp(name, L"COMPLUS_", 8) == 0 ||
    _wcsnicmp(name, L"APPDOMAIN_MANAGER", 17) == 0;
}

static int SanitizeLoaderEnvironment(void) {
  LPWCH environment = GetEnvironmentStringsW();
  if (environment == NULL) return 0;
  for (LPWCH item = environment; *item != L'\0'; item += wcslen(item) + 1) {
    const wchar_t* equals = wcschr(item, L'=');
    if (equals == NULL || equals == item) continue;
    size_t nameLength = (size_t)(equals - item);
    if (nameLength >= 256) { FreeEnvironmentStringsW(environment); return 0; }
    wchar_t name[256];
    memcpy(name, item, nameLength * sizeof(wchar_t));
    name[nameLength] = L'\0';
    if (IsLoaderSensitiveName(name) && !SetEnvironmentVariableW(name, NULL)) {
      FreeEnvironmentStringsW(environment);
      return 0;
    }
  }
  FreeEnvironmentStringsW(environment);
  return 1;
}

static int GetSelfDirectory(wchar_t* directory, DWORD capacity) {
  DWORD length = GetModuleFileNameW(NULL, directory, capacity);
  if (length == 0 || length >= capacity) return 0;
  wchar_t* slash = wcsrchr(directory, L'\\');
  if (slash == NULL) return 0;
  *slash = L'\0';
  return 1;
}

static int SameFinalPath(const wchar_t* expected, const wchar_t* actual) {
  wchar_t longExpected[32768];
  DWORD longExpectedLength = GetLongPathNameW(expected, longExpected, (DWORD)_countof(longExpected));
  const wchar_t* normalizedExpected = longExpectedLength != 0 && longExpectedLength < _countof(longExpected) ? longExpected : expected;
  if (wcsncmp(normalizedExpected, L"\\\\?\\", 4) == 0) normalizedExpected += 4;
  const wchar_t* normalized = actual;
  if (wcsncmp(normalized, L"\\\\?\\", 4) == 0) normalized += 4;
  return _wcsicmp(normalizedExpected, normalized) == 0;
}

/*
 * CreateProcessW still resolves a pathname after the managed image has been
 * attested.  Holding only that leaf therefore leaves each mutable ancestor
 * available for a rename-and-replace race.  Bind every component from the
 * mutable components beneath the volume root through the package directory
 * with FILE_SHARE_DELETE withheld.
 * Each handle is also checked against its final path, which rejects a reparse
 * component instead of silently following it.
 */
static void ReleasePackageDirectories(HANDLE* handles, DWORD count) {
  while (count > 0) CloseHandle(handles[--count]);
}

static int VerifyPackageDirectory(const wchar_t* requestedDirectory, wchar_t* finalDirectory, DWORD capacity, HANDLE* handles, DWORD* handleCount) {
  wchar_t canonical[32768];
  wchar_t packageFinalPath[32768];
  DWORD length = GetFullPathNameW(requestedDirectory, (DWORD)_countof(canonical), canonical, NULL);
  if (length == 0 || length >= _countof(canonical) || length < 3 || canonical[1] != L':' || canonical[2] != L'\\') return 0;
  DWORD count = 0;
  for (wchar_t* componentEnd = canonical + 3;; ++componentEnd) {
    if (*componentEnd != L'\\' && *componentEnd != L'\0') continue;
    wchar_t preserved = *componentEnd;
    *componentEnd = L'\0';
    DWORD attributes = GetFileAttributesW(canonical);
    HANDLE directory = INVALID_HANDLE_VALUE;
    wchar_t componentFinalPath[32768];
    DWORD finalLength = 0;
    int finalPathMatches = 0;
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) == FILE_ATTRIBUTE_DIRECTORY && count < PACKAGE_DIRECTORY_HANDLE_CAPACITY) {
      directory = CreateFileW(canonical, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
      if (directory != INVALID_HANDLE_VALUE) {
        finalLength = GetFinalPathNameByHandleW(directory, componentFinalPath, (DWORD)_countof(componentFinalPath), 0);
        finalPathMatches = finalLength != 0 && finalLength < _countof(componentFinalPath) && SameFinalPath(canonical, componentFinalPath);
      }
    }
    *componentEnd = preserved;
    if (directory == INVALID_HANDLE_VALUE || !finalPathMatches) {
      if (directory != INVALID_HANDLE_VALUE) CloseHandle(directory);
      ReleasePackageDirectories(handles, count);
      return 0;
    }
    handles[count++] = directory;
    if (preserved == L'\0') {
      const wchar_t* normalizedPackageFinalPath = componentFinalPath;
      if (wcsncmp(normalizedPackageFinalPath, L"\\\\?\\", 4) == 0) normalizedPackageFinalPath += 4;
      if (wcsncpy_s(packageFinalPath, _countof(packageFinalPath), normalizedPackageFinalPath, _TRUNCATE) != 0) {
        ReleasePackageDirectories(handles, count);
        return 0;
      }
      break;
    }
  }
  if (!SameFinalPath(requestedDirectory, packageFinalPath) || wcsncpy_s(finalDirectory, capacity, packageFinalPath, _TRUNCATE) != 0) {
    ReleasePackageDirectories(handles, count);
    return 0;
  }
  *handleCount = count;
  return 1;
}

static int VerifyManagedLauncher(const wchar_t* managedPath, HANDLE* heldHandle) {
  DWORD attributes = GetFileAttributesW(managedPath);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 || (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) return 0;
  HANDLE file = CreateFileW(managedPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  LARGE_INTEGER size;
  wchar_t finalPath[32768];
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  PUCHAR hashObject = NULL;
  DWORD hashObjectLength = 0, resultLength = 0;
  unsigned char digest[32];
  unsigned char buffer[8192];
  DWORD bytesRead = 0;
  int valid = 0;
  if (!GetFileSizeEx(file, &size) || size.QuadPart != MANAGED_LAUNCHER_BYTE_LENGTH) goto cleanup;
  DWORD finalLength = GetFinalPathNameByHandleW(file, finalPath, (DWORD)(sizeof(finalPath) / sizeof(finalPath[0])), 0);
  if (finalLength == 0 || finalLength >= (DWORD)(sizeof(finalPath) / sizeof(finalPath[0])) || !SameFinalPath(managedPath, finalPath)) goto cleanup;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) goto cleanup;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&hashObjectLength, sizeof(hashObjectLength), &resultLength, 0) != 0 || hashObjectLength == 0) goto cleanup;
  hashObject = (PUCHAR)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, hashObjectLength);
  if (hashObject == NULL || BCryptCreateHash(algorithm, &hash, hashObject, hashObjectLength, NULL, 0, 0) != 0) goto cleanup;
  for (;;) {
    if (!ReadFile(file, buffer, sizeof(buffer), &bytesRead, NULL)) goto cleanup;
    if (bytesRead == 0) break;
    if (BCryptHashData(hash, buffer, bytesRead, 0) != 0) goto cleanup;
  }
  if (BCryptFinishHash(hash, digest, sizeof(digest), 0) != 0 || memcmp(digest, MANAGED_LAUNCHER_SHA256, sizeof(digest)) != 0) goto cleanup;
  valid = 1;
cleanup:
  SecureZeroMemory(buffer, sizeof(buffer));
  SecureZeroMemory(digest, sizeof(digest));
  if (hash != NULL) BCryptDestroyHash(hash);
  if (algorithm != NULL) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (hashObject != NULL) { SecureZeroMemory(hashObject, hashObjectLength); HeapFree(GetProcessHeap(), 0, hashObject); }
  if (!valid) { CloseHandle(file); return 0; }
  *heldHandle = file;
  return 1;
}

int wmain(void) {
  wchar_t directory[32768];
  wchar_t finalDirectory[32768];
  wchar_t managedPath[32768];
  wchar_t commandLine[32770];
  HANDLE heldHandle = INVALID_HANDLE_VALUE;
  HANDLE heldDirectories[PACKAGE_DIRECTORY_HANDLE_CAPACITY];
  DWORD heldDirectoryCount = 0;
  STARTUPINFOW startupInfo;
  PROCESS_INFORMATION processInformation;
  DWORD exitCode = BOOTSTRAP_FAILURE_UNKNOWN;
  if (!SanitizeLoaderEnvironment()) return BOOTSTRAP_FAILURE_UNKNOWN;
  if (!GetSelfDirectory(directory, (DWORD)(sizeof(directory) / sizeof(directory[0])))) return BOOTSTRAP_FAILURE_BINDING;
  if (!VerifyPackageDirectory(directory, finalDirectory, (DWORD)_countof(finalDirectory), heldDirectories, &heldDirectoryCount)) return BOOTSTRAP_FAILURE_BINDING;
  if (_snwprintf_s(managedPath, _countof(managedPath), _TRUNCATE, L"%s\\%s", finalDirectory, MANAGED_LAUNCHER_NAME) < 0) { ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_BINDING; }
  if (!VerifyManagedLauncher(managedPath, &heldHandle)) { ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_BINDING; }
  if (_snwprintf_s(commandLine, _countof(commandLine), _TRUNCATE, L"\"%s\"", managedPath) < 0) { CloseHandle(heldHandle); ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_CREATE; }
  ZeroMemory(&startupInfo, sizeof(startupInfo));
  ZeroMemory(&processInformation, sizeof(processInformation));
  startupInfo.cb = sizeof(startupInfo);
  if (!CreateProcessW(managedPath, commandLine, NULL, NULL, FALSE, 0, NULL, NULL, &startupInfo, &processInformation)) { CloseHandle(heldHandle); ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_CREATE; }
  CloseHandle(processInformation.hThread);
  if (WaitForSingleObject(processInformation.hProcess, INFINITE) != WAIT_OBJECT_0 || !GetExitCodeProcess(processInformation.hProcess, &exitCode)) exitCode = BOOTSTRAP_FAILURE_WAIT;
  CloseHandle(processInformation.hProcess);
  CloseHandle(heldHandle);
  ReleasePackageDirectories(heldDirectories, heldDirectoryCount);
  return (int)exitCode;
}
