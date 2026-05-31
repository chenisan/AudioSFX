// Temporary public file hosting for BytePlus Seedance's reference_video /
// reference_audio roles (which require a *web* URL, not base64 data URI).
//
// Current host: litterbox.catbox.moe — the temporary side of catbox.moe.
//   - No signup, no API key, generous 1GB cap per file
//   - Files auto-expire after a chosen window (1h / 12h / 24h / 72h)
//   - Anonymous; no managed-delete URL token (catbox proper has userhash
//     for ownership but litterbox doesn't — auto-expiry is the deletion)
//   - Returns the public URL as a plaintext body
//
// We pick the SHORTEST window ('1h') to minimise public-exposure window.
// Seedance generation is ~30-60s, so 1h is comfortable headroom even if the
// pollers stall. The job-completion handler used to call deleteFromPublicHost
// — now it's a no-op (auto-expiry handles cleanup) but the function is kept
// so the call-sites don't need to change if we ever swap back to a host
// with a real delete API.
//
// History: previously used 0x0.st but that service disabled uploads in 2025
// after sustained AI-botnet abuse. Catbox/litterbox is the current best
// drop-in replacement with the same "curl-friendly, no signup" property.
//
// Caveats:
//   - Files are PUBLIC during the upload-to-expiry window. Don't pass user
//     private data through here — use a signed-URL cloud bucket instead.
//   - If catbox also gets hit by abuse and disables uploads, swap to:
//     bashupload.com, filebin.net, or roll a signed-URL R2 integration.

import * as fs from 'fs'
import { basename } from 'path'

const LITTERBOX_ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php'

// User-Agent — these hosts block empty / clearly-bot UAs. A pinned UA with
// contact / purpose info reduces the chance of being throttled or banned.
const UA = '13SoulMU/1.0 (+seedance refs; bridge for BytePlus Seedance API which requires web URL not base64)'

export interface PublicHostResult {
  /** Public URL like "https://litter.catbox.moe/abc.mp4". Pass to Seedance. */
  url: string
  /** Always null for litterbox (auto-expiry, no manual delete API).
   *  Retained on the interface for future hosts that support delete tokens. */
  deleteToken: string | null
  /** Basename of the uploaded file — helpful for logs. */
  filename: string
}

export async function uploadToPublicHost(localPath: string, mimeType?: string): Promise<PublicHostResult> {
  if (!fs.existsSync(localPath)) throw new Error(`file not found: ${localPath}`)
  const buf = fs.readFileSync(localPath)

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', '1h')  // shortest window — minimises public exposure
  const blob = new Blob([buf as any], { type: mimeType ?? 'application/octet-stream' })
  form.append('fileToUpload', blob, basename(localPath))

  const res = await fetch(LITTERBOX_ENDPOINT, {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': UA },
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`litterbox upload failed (${res.status}): ${errBody.slice(0, 200)}`)
  }

  const url = (await res.text()).trim()
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`litterbox returned unexpected body (not a URL): ${url.slice(0, 100)}`)
  }
  return {
    url,
    deleteToken: null,  // litterbox auto-expires; no manual delete API
    filename: basename(localPath),
  }
}

export async function deleteFromPublicHost(_url: string, _deleteToken: string | null): Promise<void> {
  // No-op: litterbox files auto-expire after the time window chosen at upload.
  // Kept as a function so the call-sites in /api/video-generate don't need to
  // know which host we're using. If we ever swap to a host with a real delete
  // API (e.g. catbox.moe proper with userhash, or signed-URL cloud bucket),
  // this function will start doing actual work without callers changing.
  return
}
