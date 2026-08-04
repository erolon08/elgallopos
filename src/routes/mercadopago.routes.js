const express = require('express');
const qrcode = require('qrcode');
const mercadopagoService = require('../services/mercadopago.service');

const router = express.Router();

router.get('/activo', (req, res) => {
  res.json({ activo: mercadopagoService.activo() });
});

router.post('/qr', async (req, res) => {
  try {
    const { venta_id, monto, descripcion } = req.body;
    if (!venta_id || !monto) return res.status(400).json({ error: 'Falta venta_id o monto' });
    const resultado = await mercadopagoService.crearPagoQr({ ventaId: venta_id, monto, descripcion });
    if (resultado.qrFijo) {
      // El monto ya se empujó al QR fijo del mostrador: no hace falta generar una imagen nueva.
      return res.json({ external_reference: resultado.externalReference, qr_fijo: true });
    }
    const qr = await qrcode.toDataURL(resultado.initPoint);
    res.json({ external_reference: resultado.externalReference, qr, link: resultado.initPoint, qr_fijo: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/qr-fijo', (req, res) => {
  res.json({ configurado: mercadopagoService.qrFijoConfigurado() });
});

router.post('/qr-fijo/configurar', async (req, res) => {
  try {
    const resultado = await mercadopagoService.configurarQrFijo();
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/estado/:externalReference', async (req, res) => {
  try {
    const { estado, mpPaymentId } = await mercadopagoService.consultarPago(req.params.externalReference);
    res.json({ estado, mp_payment_id: mpPaymentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
