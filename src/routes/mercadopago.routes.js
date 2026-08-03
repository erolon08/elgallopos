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
    const { externalReference, initPoint } = await mercadopagoService.crearPagoQr({
      ventaId: venta_id,
      monto,
      descripcion,
    });
    const qr = await qrcode.toDataURL(initPoint);
    res.json({ external_reference: externalReference, qr, link: initPoint });
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
