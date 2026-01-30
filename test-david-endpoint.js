const http = require('http');

const davidId = '694681a222efab5b362939c6';
const year = 2026;

// Token de ejemplo para un admin
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5M2E3ZWY0MzgyYTdlMGI2N2Y1ZGNiZiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTczMzAwMDAwMH0.test';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/vacations/balance?employee_id=${davidId}&year=${year}`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
};

console.log(`Consultando balance para David Redondo González (${davidId}) año ${year}...`);

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        console.log('\n✓ Balance obtenido:');
        console.log(`  vacation.carryover_total_days: ${json.vacation?.carryover_total_days}`);
        console.log(`  vacation.carryover_days: ${json.vacation?.carryover_days}`);
        console.log(`  vacation.base_allowance_days: ${json.vacation?.base_allowance_days}`);
        console.log(`  vacation.remaining_after_approved: ${json.vacation?.remaining_after_approved}`);
        console.log(`  vacation.approved_days: ${json.vacation?.approved_days}`);
        console.log(`  vacation.pending_days: ${json.vacation?.pending_days}`);
      } catch (e) {
        console.log('Response:', data);
      }
    } else {
      console.log('Error response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
