const express = require('express')
const path = require('path')
const rateLimit = require('express-rate-limit')
const { Resend } = require('resend')

const app = express()
const PORT = process.env.PORT || 3000

// Resend client (guard: no crashear el arranque si falta la API key —
// así el healthcheck de Railway pasa aunque todavía no esté configurada)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Middlewares
app.use(express.json())

// Servir videos con soporte de Range requests (para streaming 1080p)
app.use('/videos', (req, res, next) => {
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  next()
}, express.static(path.join(__dirname, 'public/videos')))

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}))

// Rate limit para el formulario
const contactLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3,
  message: { error: 'Demasiados intentos. Esperá unos minutos.' }
})

// ── API CONTACTO ─────────────────────────────────────────────
app.post('/api/contact', contactLimit, async (req, res) => {
  try {
    const { nombre, empresa, email, telefono, producto, mensaje, website } = req.body

    // Honeypot
    if (website) return res.json({ ok: true })

    // Validar
    if (!nombre || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Sin API key configurada: no rompemos, solo dejamos registro
    if (!resend) {
      console.warn('RESEND_API_KEY no configurada — mensaje recibido pero no enviado:', { nombre, email })
      return res.json({ ok: true })
    }

    // Email interno a Santino
    await resend.emails.send({
      from: 'Pina Web <no-reply@somospina.com.ar>',
      to: 'santinoantonini@gmail.com',
      subject: `Nuevo contacto desde somospina.com.ar — ${nombre}`,
      text: `
Nuevo mensaje desde el formulario de contacto.

Nombre:    ${nombre}
Empresa:   ${empresa || '—'}
Email:     ${email}
Teléfono:  ${telefono || '—'}
Interés:   ${producto || '—'}

Mensaje:
${mensaje || '—'}

---
Enviado desde somospina.com.ar
      `.trim()
    })

    // Confirmación al cliente
    await resend.emails.send({
      from: 'Pina <no-reply@somospina.com.ar>',
      to: email,
      subject: '¡Recibimos tu mensaje! — Pina',
      text: `
Hola ${nombre},

Recibimos tu mensaje y te respondemos en menos de 24 horas.

Mientras tanto podés seguirnos en:
Instagram: @pina.glutenfree
WhatsApp: 261-7051020

¡Gracias!
Equipo Pina
      `.trim()
    })

    res.json({ ok: true })

  } catch (err) {
    console.error('Contact error:', err)
    res.status(500).json({ error: 'No se pudo enviar el mensaje' })
  }
})

// ── HEALTHCHECK ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() })
})

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  // Rutas que parecen assets (con extensión) y no existen → 404 real,
  // en vez de devolver el index.html completo como si fuera imagen/video
  if (path.extname(req.path)) return res.status(404).end()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Pina server running on port ${PORT}`)
})
