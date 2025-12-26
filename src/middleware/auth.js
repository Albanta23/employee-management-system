const jwt = require('jsonwebtoken');
require('dotenv').config();

function getJwtSecret() {
    return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY;
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const secret = getJwtSecret();
    if (!secret) {
        return res.status(500).json({
            error: 'Configuración del servidor incompleta (JWT_SECRET)',
            code: 'SERVER_MISCONFIG'
        });
    }

    try {
        jwt.verify(token, secret, (err, user) => {
            if (err) {
                // 401 => el cliente debe re-autenticarse (token inválido/expirado)
                return res.status(401).json({ error: 'Token inválido o expirado' });
            }
            req.user = user;
            next();
        });
    } catch (e) {
        return res.status(500).json({ error: 'Error al verificar el token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
};

module.exports = { authenticateToken, isAdmin };
