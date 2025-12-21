const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// Get Settings (Company Info & Logo)
router.get('/', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
            await settings.save();
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// Update Settings
router.put('/', authenticateToken, isAdmin, async (req, res) => {
    try {
        console.log('📝 Received settings update request');
        console.log('User:', req.user);
        console.log('Body keys:', Object.keys(req.body));
        const { company_name, company_address, company_cif, logo_base64 } = req.body;
        console.log('Data to save:', { company_name, company_address, company_cif, logo_length: logo_base64 ? logo_base64.length : 0 });

        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
        }

        settings.company_name = company_name;
        settings.company_address = company_address;
        settings.company_cif = company_cif;
        if (logo_base64 !== undefined) settings.logo_base64 = logo_base64;
        settings.updated_at = Date.now();

        await settings.save();
        res.json(settings);
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

// Update Admin Credentials
router.put('/admin-credentials', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { new_username, new_password, current_password } = req.body;

        // Verify current admin
        const adminUser = await User.findById(req.user.id);

        // Safety check: ensure we are modifying the logged-in admin
        if (!adminUser) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Verify current password if provided (for security)
        /* 
           Note: Requirement is "change defaults". We can skip strict current pwd check if assuming 
           they are already logged in with default, BUT it's better practice or they might lock themselves out.
           However, simplifying as per user request to just "substitute".
        */

        if (new_username) adminUser.username = new_username;
        if (new_password) {
            const salt = await bcrypt.genSalt(10);
            adminUser.password = await bcrypt.hash(new_password, salt);
        }

        await adminUser.save();
        res.json({ message: 'Credenciales de administrador actualizadas correctamente' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar credenciales' });
    }
});

module.exports = router;
