const mongoose = require('mongoose');

/**
 * Modelo de Ubicación
 * Representa una ubicación geográfica que agrupa varias tiendas
 * Cada ubicación tiene su propio conjunto de tiendas con calendarios laborales independientes
 */
const LocationSchema = new mongoose.Schema({
    // Nombre de la ubicación (ej: "Madrid", "Barcelona", "Andalucía")
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    
    // Descripción de la ubicación
    description: {
        type: String,
        default: ''
    },
    
    // Array de tiendas dentro de esta ubicación
    stores: [{
        // Nombre de la tienda (debe coincidir con employee.location)
        name: {
            type: String,
            required: true,
            trim: true
        },

        // PIN de acceso al portal de fichaje en tablet (se guarda hasheado)
        // NOTA: nunca devolver este campo al cliente.
        clock_pin_hash: {
            type: String,
            default: ''
        },
        
        // Dirección de la tienda
        address: {
            type: String,
            default: ''
        },
        
        // Festivos locales específicos de esta tienda
        // Los festivos nacionales se obtienen del modelo Holiday
        localHolidays: [{
            date: {
                type: Date,
                required: true
            },
            name: {
                type: String,
                required: true
            },
            // Si es festivo recurrente anual
            isRecurring: {
                type: Boolean,
                default: false
            }
        }],
        
        // Metadata adicional
        active: {
            type: Boolean,
            default: true
        }
    }],
    
    // Metadata
    active: {
        type: Boolean,
        default: true
    }
}, { 
    timestamps: true 
});

// Índices para optimizar búsquedas
// Nota: El campo 'name' ya tiene índice único por la propiedad unique: true
LocationSchema.index({ 'stores.name': 1 });
LocationSchema.index({ active: 1 });

// Método para obtener todas las tiendas de una ubicación
LocationSchema.methods.getStoreNames = function() {
    return this.stores.map(store => store.name);
};

// Método estático para obtener ubicación por nombre de tienda
LocationSchema.statics.findByStoreName = async function(storeName) {
    return this.findOne({ 'stores.name': storeName });
};

module.exports = mongoose.model('Location', LocationSchema);
