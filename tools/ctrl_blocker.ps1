<#
    ctrl_blocker.ps1  --  temporarily disable the Ctrl keys for the whole PC.

    WHY A RUNNING PROCESS IS REQUIRED
      Windows has no "disable this key" setting. The only supported way to
      stop a key from reaching every application is a low-level keyboard
      hook (WH_KEYBOARD_LL). A hook lives inside a running process, so this
      script must stay open while Ctrl is blocked. Nothing else is touched:
      only the Ctrl key events are swallowed.

    AUTOMATIC RELEASE (no reboot, no admin rights needed)
      - press   Ctrl + Alt + Shift + F12        (emergency release)
      - press   Esc  in this window
      - close this window  /  Ctrl+C here
      - the timer runs out (default 120 minutes)
      If this process is killed or crashes, Windows removes the hook by
      itself, so Ctrl comes back immediately. There is no persistent change.

    SAFETY
      The script remembers which Ctrl keys were disabled beforehand and
      re-enables exactly those when it exits. It also switches off the
      Windows accessibility shortcuts (Sticky / Toggle / Filter keys) while
      blocking, because Shift-presses cannot reach Windows through the hook
      and could otherwise leave a key "stuck" after the block.

    USAGE
      powershell -ExecutionPolicy Bypass -File tools\ctrl_blocker.ps1
      powershell -ExecutionPolicy Bypass -File tools\ctrl_blocker.ps1 -Minutes 30
      powershell -ExecutionPolicy Bypass -File tools\ctrl_blocker.ps1 -Seconds 10
      powershell -ExecutionPolicy Bypass -File tools\ctrl_blocker.ps1 -KeepSystemBehaviour
#>

[CmdletBinding()]
param(
    [ValidateRange(0, 1440)]
    [int]$Minutes = 120,

    [ValidateRange(0, 86400)]
    [int]$Seconds = 0,

    # Do not touch the Windows accessibility shortcut flags while blocking.
    [switch]$KeepSystemBehaviour
)

$ErrorActionPreference = 'Stop'

$script:EmergencyKeyText = 'Ctrl + Alt + Shift + F12'
$script:EmergencyKey = $false
$script:ExitReason = 'finished'

# --------------------------------------------------------------------------
#  Helpers
# --------------------------------------------------------------------------

function Get-KeyboardScancodeFlags {
    # $true when the key name exists in this Windows version's scancode map.
    param([string]$Key)

    $map = 'HKLM:\SYSTEM\CurrentControlSet\Control\Keyboard Layout'
    try {
        $item = Get-ItemProperty -Path $map -Name 'Scancode Map' -ErrorAction Stop
        $bytes = @($item.'Scancode Map')
    } catch {
        return $false
    }
    if ($bytes.Count -lt 16) { return $false }

    $count = ($bytes[8] -bor ($bytes[9] -shl 8)) - 1
    for ($i = 0; $i -lt $count; $i++) {
        $offset = 12 + (4 * $i)
        if (($offset + 3) -ge $bytes.Count) { break }
        $keyCode = $bytes[$offset] -bor ($bytes[$offset + 1] -shl 8)
        if ($keyCode -eq $Key) { return $true }
    }
    return $false
}

# --------------------------------------------------------------------------
#  Native part: the low-level keyboard hook
# --------------------------------------------------------------------------

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class CtrlBlocker
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int LLKHF_UP = 0x80;

    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;
    private const int VK_F12 = 0x7B;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public int vkCode;
        public int scanCode;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    private static LowLevelKeyboardProc hookProc;
    private static IntPtr hookHandle = IntPtr.Zero;
    private static Thread pumpThread;
    private static bool ctrlDown;
    private static bool altDown;
    private static bool shiftDown;

    public static bool Active { get; private set; }
    public static int SwallowedKeys { get; private set; }
    public static int EmergencyKey { get; private set; }
    public static int LastError { get; private set; }

    private static bool Physical(int vk)
    {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    public static void Start()
    {
        if (pumpThread != null) return;

        // Seed modifier state from the physical keyboard state.
        ctrlDown = Physical(VK_CONTROL);
        altDown = Physical(VK_MENU);
        shiftDown = Physical(VK_SHIFT);

        pumpThread = new Thread(Pump);
        pumpThread.IsBackground = true;
        pumpThread.Name = "CtrlBlockerHook";
        pumpThread.Start();

        for (int i = 0; i < 300 && hookHandle == IntPtr.Zero && LastError == 0; i++)
        {
            Thread.Sleep(10);
        }
        if (hookHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException("SetWindowsHookEx failed, error " + LastError);
        }
    }

    public static void Stop()
    {
        IntPtr handle = hookHandle;
        hookHandle = IntPtr.Zero;
        Active = false;
        if (handle != IntPtr.Zero)
        {
            UnhookWindowsHookEx(handle);
        }
    }

    private static void Pump()
    {
        hookProc = new LowLevelKeyboardProc(HookCallback);
        hookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
        if (hookHandle == IntPtr.Zero)
        {
            LastError = Marshal.GetLastWin32Error();
            return;
        }

        Active = true;

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int message = wParam.ToInt32();
            if (message == WM_KEYDOWN || message == WM_KEYUP || message == WM_SYSKEYDOWN || message == WM_SYSKEYUP)
            {
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool isUp = (info.flags & LLKHF_UP) != 0;
                int vk = info.vkCode;

                if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL)
                {
                    ctrlDown = !isUp;
                }
                else if (vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU)
                {
                    altDown = !isUp;
                }
                else if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT)
                {
                    shiftDown = !isUp;
                }

                if (!isUp && vk == VK_F12 && ctrlDown && altDown && shiftDown)
                {
                    EmergencyKey++;
                    return (IntPtr)1;
                }

                if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL)
                {
                    if (!isUp) { SwallowedKeys++; }
                    return (IntPtr)1;
                }
            }
        }

        return CallNextHookEx(hookHandle, nCode, wParam, lParam);
    }
}
'@

# --------------------------------------------------------------------------
#  Accessibility shortcut flags (remember -> disable -> restore)
# --------------------------------------------------------------------------

$accessibilityPath = 'HKCU:\Control Panel\Accessibility'
$accessibilityNames = @('StickyKeys', 'ToggleKeys', 'FilterKeys')
$accessibilitySaved = @{}

function Set-AccessibilityFlags {
    param([int]$Value)

    foreach ($name in $accessibilityNames) {
        try {
            Set-ItemProperty -Path $accessibilityPath -Name $name -Value $Value -ErrorAction Stop
        } catch {
            Write-Host ("  ! could not write {0}: {1}" -f $name, $_.Exception.Message) -ForegroundColor DarkYellow
        }
    }
}

# --------------------------------------------------------------------------
#  Main
# --------------------------------------------------------------------------

function Show-Banner {
    param([string]$Duration)

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host '  CTRL KEY BLOCKER' -ForegroundColor Cyan
    Write-Host '  Left Ctrl / Right Ctrl / keypad Ctrl are disabled' -ForegroundColor Cyan
    Write-Host '  for every application on this PC.' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ("  Release keys : {0}" -f $script:EmergencyKeyText) -ForegroundColor Yellow
    Write-Host  '  or           : Esc in this window / close this window' -ForegroundColor Yellow
    Write-Host ("  Auto release : {0}" -f $Duration) -ForegroundColor Yellow
    Write-Host ''
}

function Get-RemainingText {
    param([double]$Seconds)

    if ($Seconds -lt 0) { $Seconds = 0 }
    $ts = [TimeSpan]::FromSeconds([Math]::Round($Seconds))
    if ($ts.TotalHours -ge 1) {
        return ('{0:00}:{1:00}:{2:00}' -f [int][Math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
    }
    return ('{0:00}:{1:00}' -f $ts.Minutes, $ts.Seconds)
}

# Duration
$totalSeconds = 0
if ($Seconds -gt 0) {
    $totalSeconds = $Seconds
} elseif ($Minutes -gt 0) {
    $totalSeconds = $Minutes * 60
} else {
    Write-Host 'Nothing to do: -Minutes and -Seconds are both 0.' -ForegroundColor Red
    exit 2
}
$durationText = Get-RemainingText -Seconds $totalSeconds

# Pre-flight: warn if Ctrl was already remapped through the registry.
$preDisabled = @()
foreach ($key in @('1D', '1D 00', 'E0 1D 00')) {
    if (Get-KeyboardScancodeFlags -Key $key) { $preDisabled += $key }
}

$restoreNeeded = $false
$consoleInput = $true

try {
    Show-Banner -Duration $durationText

    if ($preDisabled.Count -gt 0) {
        Write-Host ("  Note: Ctrl already disabled in the registry ({0}); leaving it as is." -f ($preDisabled -join ', ')) -ForegroundColor DarkYellow
        Write-Host ''
    }

    if (-not $KeepSystemBehaviour) {
        foreach ($name in $accessibilityNames) {
            try {
                $accessibilitySaved[$name] = [int](Get-ItemProperty -Path $accessibilityPath -Name $name -ErrorAction Stop).$name
            } catch {
                $accessibilitySaved[$name] = 0
            }
        }
        Set-AccessibilityFlags -Value 0
    }

    Add-Type -TypeDefinition $nativeSource -Language CSharp
    [CtrlBlocker]::Start()

    if (-not [CtrlBlocker]::Active) {
        throw 'The keyboard hook could not be installed.'
    }

    Write-Host '  [ON] Ctrl is now blocked. This window must stay open.' -ForegroundColor Green
    Write-Host ''

    $deadline = (Get-Date).AddSeconds($totalSeconds)
    $lastTitle = Get-Date
    $exitReason = 'timer expired'

    while ($true) {
        Start-Sleep -Milliseconds 200

        if ([CtrlBlocker]::EmergencyKey -gt 0) {
            $script:EmergencyKey = $true
            $exitReason = 'emergency key'
            break
        }

        if ($consoleInput) {
            try {
                if ([Console]::KeyAvailable) {
                    $pressed = [Console]::ReadKey($true)
                    if ($pressed.Key -eq [ConsoleKey]::Escape) {
                        $exitReason = 'Esc pressed'
                        break
                    }
                }
            } catch {
                $consoleInput = $false
            }
        }

        if (-not [CtrlBlocker]::Active) {
            $exitReason = 'hook was removed'
            break
        }

        $remaining = ($deadline - (Get-Date)).TotalSeconds
        if ($remaining -le 0) {
            $exitReason = 'timer expired'
            break
        }

        if (((Get-Date) - $lastTitle).TotalSeconds -ge 5) {
            $lastTitle = Get-Date
            try {
                $Host.UI.RawUI.WindowTitle = ('Ctrl blocked - {0} left - {1}' -f (Get-RemainingText -Seconds $remaining), $script:EmergencyKeyText)
            } catch { }
        }
    }

    $script:ExitReason = $exitReason
}
catch {
    $script:ExitReason = 'error: ' + $_.Exception.Message
    Write-Host ''
    Write-Host ('  [ERROR] ' + $_.Exception.Message) -ForegroundColor Red
}
finally {
    try { [CtrlBlocker]::Stop() } catch { }

    if (-not $KeepSystemBehaviour) {
        foreach ($name in $accessibilityNames) {
            $original = 0
            if ($accessibilitySaved.ContainsKey($name)) { $original = $accessibilitySaved[$name] }
            try {
                Set-ItemProperty -Path $accessibilityPath -Name $name -Value $original -ErrorAction Stop
            } catch { }
        }
    }

    Write-Host ''
    if ($script:EmergencyKey) {
        Write-Host '  [OFF] Emergency key pressed. Ctrl is enabled again.' -ForegroundColor Green
    } elseif ($script:ExitReason -like 'error:*') {
        Write-Host '  [OFF] Ctrl is enabled again (the block failed to start or stopped early).' -ForegroundColor Yellow
    } else {
        Write-Host ('  [OFF] Ctrl is enabled again ({0}).' -f $script:ExitReason) -ForegroundColor Green
    }
    Write-Host ('  Blocked Ctrl presses during this session: {0}' -f [CtrlBlocker]::SwallowedKeys) -ForegroundColor DarkGray
    Write-Host ''
}
