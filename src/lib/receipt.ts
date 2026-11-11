/* Getting a receipt photo / PDF ready for upload (the server accepts JPG, PNG, WebP or PDF up to 2 MB). */

export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Photos larger than this are scaled down (phone photos are often 3–8 MB) */
const SHRINK_ABOVE = 900 * 1024
const MAX_SIDE = 1800

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= RECEIPT_MAX_BYTES) return blob
  }
  throw new Error('This photo is too large even after shrinking it. Try a smaller photo.')
}

/** Returns the file to upload, or throws a message for the person. */
export async function prepareReceipt(file: File): Promise<{ file: Blob; name: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > RECEIPT_MAX_BYTES) throw new Error(`This PDF is ${formatBytes(file.size)}. PDFs can be at most 2 MB.`)
    return { file, name: file.name }
  }
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Attach a photo (JPG, PNG or WebP) or a PDF of the receipt.')
  if (file.size <= SHRINK_ABOVE) return { file, name: file.name }
  const small = await shrink(file)
  return { file: small, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' }
}
