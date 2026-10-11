"""Windows test helper: hold a file the way Firefox holds <profile>/parent.lock."""

import ctypes
from ctypes import wintypes

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
CREATE_ALWAYS = 2


class FirefoxStyleLock:
    """Opens `path` with no sharing (like Firefox's nsProfileLock) until closed."""

    def __init__(self, path):
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        create = self.kernel32.CreateFileW
        create.restype = wintypes.HANDLE
        create.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
        ]
        self.handle = create(path, GENERIC_READ | GENERIC_WRITE, 0, None, CREATE_ALWAYS, 0, None)
        if self.handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel32.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
