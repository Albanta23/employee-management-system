const { dbAll, dbGet } = require('./src/database/db');

async function testStats() {
    try {
        const stats = {};
        const totalResult = await dbGet('SELECT COUNT(*) as total FROM employees WHERE status = "active"');
        stats.totalActive = totalResult.total;

        const byLocation = await dbAll(
            'SELECT location, COUNT(*) as count FROM employees WHERE status = "active" GROUP BY location ORDER BY count DESC'
        );
        stats.byLocation = byLocation;

        const byPosition = await dbAll(
            'SELECT position, COUNT(*) as count FROM employees WHERE status = "active" GROUP BY position ORDER BY count DESC LIMIT 10'
        );
        stats.byPosition = byPosition;

        console.log('--- STATS RESULTS ---');
        console.log(JSON.stringify(stats, null, 2));
        console.log('----------------------');
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

testStats();
