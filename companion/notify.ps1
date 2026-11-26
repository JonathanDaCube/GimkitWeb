$ErrorActionPreference = 'Stop'
$appId = 'JonathanDaCube.GimkitCommunityApp'
$iconPath = Join-Path $PSScriptRoot 'notification-icon.png'
$shortcutIcon = Join-Path $PSScriptRoot 'notification-icon.ico'
$executable = Join-Path $PSScriptRoot 'gimkitapp.exe'
foreach ($file in @($iconPath, $shortcutIcon, $executable)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Notification component not found: $file"
    }
}

$source = @'
using System;
using System.Runtime.InteropServices;

public static class GimkitShortcutIdentity
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Value;
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHGetPropertyStoreFromParsingName(
        string path, IntPtr bindingContext, uint flags, ref Guid iid, out IPropertyStore store);

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int PropVariantClear(ref PropVariant value);

    public static string GetAppId(string path)
    {
        Guid iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0, ref iid, out store));
        var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        PropVariant value;
        try
        {
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Value) : null; }
            finally { PropVariantClear(ref value); }
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    public static void SetAppId(string path, string appId)
    {
        Guid iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store));
        var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        var value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(appId) };
        try
        {
            Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
            Marshal.ThrowExceptionForHR(store.Commit());
        }
        finally
        {
            PropVariantClear(ref value);
            Marshal.ReleaseComObject(store);
        }
    }
}
'@
Add-Type -TypeDefinition $source
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Gimkit Community App.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$exists = Test-Path -LiteralPath $shortcutPath
$existingAppId = if ($exists) { [GimkitShortcutIdentity]::GetAppId($shortcutPath) } else { $null }
if ($exists -and $shortcut.TargetPath -ne $executable -and $existingAppId -ne $appId) {
    throw "A different Start menu shortcut already exists at $shortcutPath. Rename it before creating the Gimkit notification identity."
}
if (-not $exists -or $shortcut.TargetPath -ne $executable -or $shortcut.IconLocation -ne "$shortcutIcon,0" -or $existingAppId -ne $appId) {
    $shortcut.TargetPath = $executable
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.IconLocation = "$shortcutIcon,0"
    $shortcut.Save()
    [GimkitShortcutIdentity]::SetAppId($shortcutPath, $appId)
}

$registration = "HKCU:\Software\Classes\AppUserModelId\$appId"
$null = New-Item -Path $registration -Force
$null = New-ItemProperty -Path $registration -Name DisplayName -Value 'Gimkit Community App' -PropertyType String -Force
$null = New-ItemProperty -Path $registration -Name IconUri -Value $iconPath -PropertyType String -Force

$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text><image placement="appLogoOverride" hint-crop="circle" src=""/></binding></visual></toast>')
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).InnerText = 'GimkitWeb meeting started'
$texts.Item(1).InnerText = $env:GIMKIT_MEETING_TITLE
$xml.GetElementsByTagName('image').Item(0).SetAttribute('src', ([System.Uri]$iconPath).AbsoluteUri)
$notification = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
$setting = $notifier.GetType().GetProperty('Setting').GetValue($notifier)
if ($setting.ToString() -ne 'Enabled') {
    throw "Windows notifications are disabled for Gimkit Community App ($setting)."
}
$notifier.Show($notification)
