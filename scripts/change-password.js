const readline = require('readline');
const bcrypt = require('bcrypt');
const { db, dbRun, initializeDatabase } = require('../src/database/db');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function changePassword() {
    console.log('\n===========================================');
    console.log('🔐 CAMBIO DE CONTRASEÑA DE ADMINISTRADOR');
    console.log('===========================================\n');

    try {
        await initializeDatabase();

        const username = await question('Usuario (presiona Enter para "admin"): ') || 'admin';
        
        console.log('\n⚠️  La contraseña debe tener al menos 8 caracteres\n');
        const newPassword = await question('Nueva contraseña: ');
        
        if (newPassword.length < 8) {
            console.log('\n❌ Error: La contraseña debe tener al menos 8 caracteres');
            rl.close();
            process.exit(1);
        }

        const confirmPassword = await question('Confirmar contraseña: ');

        if (newPassword !== confirmPassword) {
            console.log('\n❌ Error: Las contraseñas no coinciden');
            rl.close();
            process.exit(1);
        }

        // Hash de la nueva contraseña
        console.log('\n🔄 Procesando...');
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar en la base de datos
        await dbRun(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashedPassword, username]
        );

        console.log('\n✅ Contraseña cambiada correctamente');
        console.log('==========================================');
        console.log(`Usuario: ${username}`);
        console.log('Contraseña: ********');
        console.log('==========================================\n');
        console.log('⚠️  IMPORTANTE: Guarda estas credenciales en un lugar seguro\n');

    } catch (error) {
        console.error('\n❌ Error al cambiar la contraseña:', error.message);
        process.exit(1);
    }

    rl.close();
    process.exit(0);
}

changePassword();
