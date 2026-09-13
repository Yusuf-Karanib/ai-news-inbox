$ErrorActionPreference = 'Stop'

function Read-SecretText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$botToken = Read-SecretText 'Paste the Telegram bot token'
try {
    $response = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$botToken/getWebhookInfo"
    if (-not $response.ok) { throw 'Telegram rejected the request.' }

    $info = $response.result
    [pscustomobject]@{
        WebhookUrl = $info.url
        PendingUpdates = $info.pending_update_count
        LastErrorTime = if ($info.last_error_date) {
            (Get-Date '1970-01-01T00:00:00Z').AddSeconds([double]$info.last_error_date).ToLocalTime()
        } else {
            'None'
        }
        LastErrorMessage = if ($info.last_error_message) { $info.last_error_message } else { 'None' }
        AllowedUpdates = @($info.allowed_updates) -join ', '
    } | Format-List
}
finally {
    $botToken = $null
}
