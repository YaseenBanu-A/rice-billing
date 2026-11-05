const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ')
}

/** Whole number in the Indian system: crore, lakh, thousand. */
function integerWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1_00_00_000)
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000)
  const thousand = Math.floor((n % 1_00_000) / 1000)
  const rest = n % 1000
  if (crore) parts.push(`${integerWords(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (rest) parts.push(belowThousand(rest))
  return parts.join(' ')
}

/** e.g. 1234.5 → "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" */
export function amountInWords(amount: number, currency = 'INR'): string {
  const rounded = Math.round(Math.abs(amount) * 100)
  const whole = Math.floor(rounded / 100)
  const fraction = rounded % 100
  const [major, minor] = currency === 'INR' ? ['Rupees', 'Paise'] : [currency, 'Cents']
  return `${major} ${integerWords(whole)}${fraction ? ` and ${belowHundred(fraction)} ${minor}` : ''} Only`
}
