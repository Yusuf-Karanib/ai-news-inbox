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

$projectRef = (Read-Host 'Paste your Supabase project reference').Trim()
if ($projectRef -notmatch '^[a-z0-9]{10,40}$') {
    throw 'That project reference does not look valid.'
}

$cronSecret = Read-SecretText 'Paste CRON_SECRET'
try {
    $headers = @{ 'x-cron-secret' = $cronSecret }
    $url = "https://$projectRef.supabase.co/functions/v1/daily-news?manual=true"
    $result = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType 'application/json' -Body '{}'
    $result | ConvertTo-Json -Depth 6
}
finally {
    $cronSecret = $null
}
