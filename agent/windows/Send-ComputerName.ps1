<#
.SYNOPSIS
    この Windows 端末の PC 名 (COMPUTERNAME) を、社内IT資産管理システムへ送信します。

.DESCRIPTION
    初回だけ -Setup で接続先と端末連携キーを設定し、以降は引数なしで実行すると PC 名を送信します。
    -RegisterTask を実行すると、起動時と毎日 9:00 に自動で送信するタスクを登録します。

    端末連携キーは管理画面の端末詳細で発行します (端末ごとに異なり、他の端末の更新には使えません)。
    キーはこのスクリプトには書き込まず、Windows の DPAPI で暗号化して設定フォルダーに保存します。
    設定フォルダーは SYSTEM・Administrators・設定したユーザーのみアクセスできるようにします。

    Windows PowerShell 5.1 以降で動作します。

.PARAMETER Setup
    接続先と端末連携キーを設定します。キーは入力を求められます (画面には表示されません)。
    配布ツールから自動設定する場合は、環境変数 DEVICE_KEEPER_AGENT_TOKEN にキーを入れて実行できます。

.PARAMETER ServerUrl
    システムの URL (例: https://assets.example.co.jp)。HTTPS 必須です。

.PARAMETER DeviceId
    管理画面の端末 ID (端末連携キーの発行画面に表示される設定コマンドに含まれます)。

.PARAMETER RegisterTask
    起動時と毎日 9:00 に PC 名を送信するタスクを登録します (管理者として実行)。

.PARAMETER Uninstall
    登録したタスクと設定フォルダー (端末連携キーを含む) を削除します (管理者として実行)。

.PARAMETER ConfigDir
    設定フォルダー。既定は C:\ProgramData\DeviceKeeper。

.PARAMETER AllowHttp
    HTTP での接続を許可します。開発環境での動作確認専用です (本番では使わないでください)。

.EXAMPLE
    .\Send-ComputerName.ps1 -Setup -ServerUrl https://assets.example.co.jp -DeviceId 12
    .\Send-ComputerName.ps1 -RegisterTask
    .\Send-ComputerName.ps1

.NOTES
    終了コード: 0 成功 / 1 設定エラー / 2 PC 名を取得できない / 3 認証エラー (キーが無効・別の端末) / 4 通信・サーバーエラー
#>
[CmdletBinding(DefaultParameterSetName = 'Send')]
param(
    [Parameter(ParameterSetName = 'Setup', Mandatory = $true)][switch]$Setup,
    [Parameter(ParameterSetName = 'Setup', Mandatory = $true)][string]$ServerUrl,
    [Parameter(ParameterSetName = 'Setup', Mandatory = $true)][ValidateRange(1, 2147483647)][int]$DeviceId,
    [Parameter(ParameterSetName = 'Setup')][switch]$AllowHttp,
    [Parameter(ParameterSetName = 'RegisterTask', Mandatory = $true)][switch]$RegisterTask,
    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)][switch]$Uninstall,
    [string]$ConfigDir = (Join-Path $env:ProgramData 'DeviceKeeper')
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$TaskName = 'DeviceKeeper-SendComputerName'
$ConfigFile = Join-Path $ConfigDir 'config.json'
$TokenFile = Join-Path $ConfigDir 'token.bin'
$LogDir = Join-Path $ConfigDir 'logs'
$LogFile = Join-Path $LogDir 'send-computer-name.log'
# DPAPI の追加エントロピー (このツール以外が同じ方法で復号しにくくする)
$Entropy = [System.Text.Encoding]::UTF8.GetBytes('device-keeper-agent-v1')

Add-Type -AssemblyName System.Security

function Write-Log {
    param([ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level, [string]$Message)
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $Level, $Message
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        # 1MB を超えたら 1 世代だけ残して切り替える
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) {
            Move-Item -Path $LogFile -Destination "$LogFile.1" -Force
        }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {
        # ログを書けなくても処理は続ける
    }
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red } else { Write-Host $line }
}

function Test-Administrator {
    $principal = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Protect-ConfigDir {
    # 継承を外し、SYSTEM・Administrators・実行ユーザーのみフルコントロールにする (SID で指定し言語設定に依存しない)
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $output = & icacls.exe $ConfigDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${me}:(OI)(CI)F" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "設定フォルダーのアクセス権を設定できませんでした: $output" }
}

function Get-ComputerNameValue {
    $name = $env:COMPUTERNAME
    if ([string]::IsNullOrWhiteSpace($name)) { $name = [System.Environment]::MachineName }
    if ([string]::IsNullOrWhiteSpace($name)) { return $null }
    return $name.Trim()
}

function Save-Token([string]$Token) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Token)
    try {
        # LocalMachine スコープ: この端末上でのみ復号できる (SYSTEM で動くタスクからも復号できる)
        $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $Entropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
        [System.IO.File]::WriteAllBytes($TokenFile, $protected)
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Read-Token {
    if (-not (Test-Path $TokenFile)) { throw '端末連携キーが設定されていません。-Setup を実行してください。' }
    $protected = [System.IO.File]::ReadAllBytes($TokenFile)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $Entropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { return [System.Text.Encoding]::UTF8.GetString($bytes) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Read-TokenInput {
    if (-not [string]::IsNullOrEmpty($env:DEVICE_KEEPER_AGENT_TOKEN)) {
        $token = $env:DEVICE_KEEPER_AGENT_TOKEN
        # 子プロセスに引き継がないよう、読み取ったら環境変数から消す
        Remove-Item Env:\DEVICE_KEEPER_AGENT_TOKEN -ErrorAction SilentlyContinue
        return $token.Trim()
    }
    $secure = Read-Host -AsSecureString '管理画面で発行した端末連携キーを貼り付けてください'
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return ([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-ErrorMessage($ErrorRecord) {
    # サーバーが返した JSON の error を取り出す (PowerShell 5.1 と 7 の両方に対応)
    $body = $null
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) { $body = $ErrorRecord.ErrorDetails.Message }
    elseif ($ErrorRecord.Exception.PSObject.Properties['Response'] -and $ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.PSObject.Methods['GetResponseStream']) {
        try {
            $reader = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
        } catch { }
    }
    if ($body) {
        try { return ($body | ConvertFrom-Json).error } catch { return $body }
    }
    return $ErrorRecord.Exception.Message
}

function Get-StatusCode($ErrorRecord) {
    if ($ErrorRecord.Exception.PSObject.Properties['Response'] -and $ErrorRecord.Exception.Response) {
        try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { }
    }
    return 0
}

# ---------------------------------------------------------------------------
# -Setup: 接続先と端末連携キーを設定する
# ---------------------------------------------------------------------------
if ($PSCmdlet.ParameterSetName -eq 'Setup') {
    $uri = $null
    if (-not [System.Uri]::TryCreate($ServerUrl.TrimEnd('/'), [System.UriKind]::Absolute, [ref]$uri)) { Write-Log ERROR "ServerUrl が正しくありません: $ServerUrl"; exit 1 }
    if ($uri.Scheme -ne 'https' -and -not ($AllowHttp -and $uri.Scheme -eq 'http')) { Write-Log ERROR 'ServerUrl は https:// で指定してください (通信を暗号化するため)。'; exit 1 }

    $token = Read-TokenInput
    if ($token -notmatch '^dkdev_[A-Za-z0-9_-]{20,}$') { Write-Log ERROR '端末連携キーの形式が正しくありません。管理画面で発行したキーを貼り付けてください。'; exit 1 }

    try {
        if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }
        Protect-ConfigDir
        Save-Token $token
        $config = [ordered]@{ serverUrl = $uri.GetLeftPart([System.UriPartial]::Authority); deviceId = $DeviceId; allowHttp = [bool]$AllowHttp }
        $config | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
    } catch {
        Write-Log ERROR "設定を保存できませんでした: $($_.Exception.Message)"
        exit 1
    } finally {
        $token = $null
    }
    Write-Log INFO "設定を保存しました (接続先 $($config.serverUrl)、端末 ID $DeviceId)。続けて PC 名を送信して確認します。"
    # 設定直後に 1 回送信して確認する
    & $PSCommandPath -ConfigDir $ConfigDir
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# -RegisterTask: 定期実行のタスクを登録する
# ---------------------------------------------------------------------------
if ($PSCmdlet.ParameterSetName -eq 'RegisterTask') {
    if (-not (Test-Administrator)) { Write-Log ERROR 'タスクの登録は「管理者として実行」した PowerShell で行ってください。'; exit 1 }
    if (-not (Test-Path $ConfigFile)) { Write-Log ERROR '先に -Setup で設定してください。'; exit 1 }
    # タスクからは設定フォルダー内のコピーを実行する (元のファイルを移動・削除しても動くように)
    $installed = Join-Path $ConfigDir 'Send-ComputerName.ps1'
    if ($PSCommandPath -ne $installed) { Copy-Item -Path $PSCommandPath -Destination $installed -Force }
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -ConfigDir `"$ConfigDir`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $atStartup = New-ScheduledTaskTrigger -AtStartup
    $atStartup.Delay = 'PT5M'
    $daily = New-ScheduledTaskTrigger -Daily -At 9am
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $daily) -Principal $principal -Settings $settings -Description '社内IT資産管理システムへ PC 名を送信します' -Force | Out-Null
    Write-Log INFO "タスク「$TaskName」を登録しました (起動 5 分後と毎日 9:00 に実行)。"
    exit 0
}

# ---------------------------------------------------------------------------
# -Uninstall: タスクと設定を削除する
# ---------------------------------------------------------------------------
if ($PSCmdlet.ParameterSetName -eq 'Uninstall') {
    if (-not (Test-Administrator)) { Write-Host '削除は「管理者として実行」した PowerShell で行ってください。' -ForegroundColor Red; exit 1 }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $ConfigDir) { Remove-Item -Path $ConfigDir -Recurse -Force }
    Write-Host 'タスクと設定 (端末連携キーを含む) を削除しました。管理画面で端末連携キーを無効にしてください。'
    exit 0
}

# ---------------------------------------------------------------------------
# 送信 (引数なし)
# ---------------------------------------------------------------------------
try {
    if (-not (Test-Path $ConfigFile)) { throw '設定がありません。-Setup を実行してください。' }
    $config = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $token = Read-Token
} catch {
    Write-Log ERROR "設定を読み込めませんでした: $($_.Exception.Message)"
    exit 1
}

$computerName = Get-ComputerNameValue
if (-not $computerName) {
    Write-Log ERROR 'PC 名を取得できませんでした (COMPUTERNAME が空です)。'
    exit 2
}

# PowerShell 5.1 の既定では TLS 1.2 が無効な場合がある
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12

$endpoint = '{0}/api/devices/{1}/computer-name' -f $config.serverUrl, $config.deviceId
$body = [System.Text.Encoding]::UTF8.GetBytes((@{ computerName = $computerName } | ConvertTo-Json -Compress))
$headers = @{ Authorization = "Bearer $token" }

for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 30 -UseBasicParsing
        $state = if ($response.changed) { '更新しました' } else { '変更なし (取得日時のみ更新)' }
        Write-Log INFO "PC 名「$computerName」を送信しました: $state (端末 $($response.assetNumber))"
        exit 0
    } catch {
        $status = Get-StatusCode $_
        $message = Get-ErrorMessage $_
        if ($status -in 401, 403) {
            Write-Log ERROR "認証に失敗しました (HTTP $status): $message 管理画面で端末連携キーを確認し、-Setup をやり直してください。"
            exit 3
        }
        if ($status -ge 400 -and $status -lt 500) {
            Write-Log ERROR "送信内容が受け付けられませんでした (HTTP $status): $message"
            exit 4
        }
        $reason = if ($status -gt 0) { "HTTP $status" } else { 'サーバーに接続できません' }
        Write-Log WARN "送信に失敗しました ($attempt/3 回目、$reason): $message"
        if ($attempt -lt 3) { Start-Sleep -Seconds (10 * $attempt) }
    } finally {
        if ($attempt -ge 3) { $token = $null; $headers = $null }
    }
}
Write-Log ERROR 'PC 名を送信できませんでした。ネットワークとサーバーの状態を確認してください。'
exit 4
