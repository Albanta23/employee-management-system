const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/vacations/balance?employee_id=694681a222efab5b362939bc&year=2026',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5M2E3ZWY0MzgyYTdlMGI2N2Y1ZGNiZiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTczMzAwMDAwMH0.test'
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
