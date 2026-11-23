// (teste local) gera um token igual ao do Supabase Auth para o PostgREST local
const crypto = require('crypto')
const [secret, email] = process.argv.slice(2)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const h = b64({ alg: 'HS256', typ: 'JWT' })
const p = b64({ role: 'authenticated', email, app_metadata: { provider: 'google' }, sub: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 86400 })
const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
console.log(`${h}.${p}.${s}`)
