const { google } = require('googleapis');
const functions = require('@google-cloud/functions-framework');

const SPREADSHEET_ID = '1ZW80PUg0UOTW3INjJttkXshEGzUFuLsfXN6eh9yTXMo';
const SHEET_NAMES = { JOBS: 'Jobs', EMERGENCY: 'Emergency', INQUIRY: 'Inquiry' };

async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return auth.getClient();
}

async function getSheetsClient() {
  const authClient = await getAuthClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

function getTimestamp() {
  return new Date().toISOString();
}

async function appendRow(sheetName, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

async function findJobByPhone(phoneNumber) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.JOBS}!A:K`
  });
  const rows = response.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === phoneNumber) {
      return { rowIndex: i + 1, rowData: rows[i] };
    }
  }
  return null;
}

async function updateRow(sheetName, rowIndex, updates) {
  const sheets = await getSheetsClient();
  for (const [col, value] of Object.entries(updates)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${col}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] }
    });
  }
}

// MAIN WEBHOOK
functions.http('webhook', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-retell-signature');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    // Log incoming request for debugging
    console.log('Request body:', JSON.stringify(req.body));
    
    // Retell sends args directly, or { call, args } format
    const args = req.body.args || req.body;
    const action = args.action || req.query.action || '';
    
    console.log('Action:', action, 'Args:', JSON.stringify(args));

    let result = '';

    if (action === 'createJobDetails' || (args.name && args.service_type)) {
      const row = [
        getTimestamp(),
        args.name || '',
        args.email || '',
        args.phone_number || '',
        args.service_type || '',
        args.preferred_Time || args.preferred_time || '',
        args.location_type || '',
        args.location || '',
        args.appointment_status || 'Booked',
        args.call_duration || ''
      ];
      await appendRow(SHEET_NAMES.JOBS, row);
      result = 'Job created successfully for ' + (args.name || 'customer');

    } else if (action === 'getJob') {
      const job = await findJobByPhone(args.phone_number);
      if (job) {
        result = `Found job: ${job.rowData[1]}, Service: ${job.rowData[4]}, Status: ${job.rowData[8]}`;
      } else {
        result = 'No job found for this phone number';
      }

    } else if (action === 'reschedule' || action === 'Reschedule_caller_information') {
      const job = await findJobByPhone(args.phone_number);
      if (job) {
        const updates = { 'A': getTimestamp(), 'I': 'Rescheduled' };
        if (args.preferred_Time) updates['F'] = args.preferred_Time;
        await updateRow(SHEET_NAMES.JOBS, job.rowIndex, updates);
        result = 'Job rescheduled successfully';
      } else {
        result = 'No job found to reschedule';
      }

    } else if (action === 'cancellation' || action === 'Cancellation_caller_Information') {
      const job = await findJobByPhone(args.phone_number);
      if (job) {
        await updateRow(SHEET_NAMES.JOBS, job.rowIndex, { 'A': getTimestamp(), 'I': 'Cancelled' });
        result = 'Job cancelled successfully';
      } else {
        result = 'No job found to cancel';
      }

    } else if (action === 'logEmergency' || args.emergency_details) {
      const row = [
        getTimestamp(),
        args.name || '',
        args.phone_number || '',
        args.location || '',
        args.emergency_details || '',
        args.call_duration || ''
      ];
      await appendRow(SHEET_NAMES.EMERGENCY, row);
      result = 'Emergency logged successfully';

    } else if (action === 'collectInquiryDetails' || args.inquiry_details) {
      const row = [
        getTimestamp(),
        args.name || '',
        args.phone_number || '',
        args.location || '',
        args.inquiry_details || args.service_type || '',
        args.call_duration || ''
      ];
      await appendRow(SHEET_NAMES.INQUIRY, row);
      result = 'Inquiry logged successfully';

    } else {
      result = 'Request received';
    }

    // Retell expects a simple string or { result: string }
    return res.status(200).send(result);

  } catch (error) {
    console.error('Error:', error);
    return res.status(200).send('Error processing request');
  }
});
