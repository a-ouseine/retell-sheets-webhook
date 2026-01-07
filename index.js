const { google } = require('googleapis');
const functions = require('@google-cloud/functions-framework');

// Configuration
const SPREADSHEET_ID = '1ZW80PUg0UOTW3INjJttkXshEGzUFuLsfXN6eh9yTXMo';
const SHEET_NAMES = {
  JOBS: 'Jobs',
  EMERGENCY: 'Emergency',
  INQUIRY: 'Inquiry'
};

// Initialize Google Sheets API
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

// Helper: Get current timestamp
function getTimestamp() {
  return new Date().toISOString();
}

// Helper: Append row to a sheet
async function appendRow(sheetName, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values]
    }
  });
}

// Helper: Find row by phone number in Jobs sheet
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

// Helper: Update multiple cells in a row
async function updateRow(sheetName, rowIndex, updates) {
  const sheets = await getSheetsClient();
  for (const [col, value] of Object.entries(updates)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${col}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[value]]
      }
    });
  }
}

// HANDLER: createJobDetails
async function handleCreateJobDetails(data) {
  const row = [
    getTimestamp(),
    data.name || '',
    data.email || '',
    data.phone_number || '',
    data.service_type || '',
    data.preferred_Time || '',
    data.location_type || '',
    data.location || '',
    data.appointment_status || 'Booked',
    data.call_duration || ''
  ];
  await appendRow(SHEET_NAMES.JOBS, row);
  return { success: true, message: 'Job created successfully' };
}

// HANDLER: getJob
async function handleGetJob(data) {
  const phoneNumber = data.phone_number;
  if (!phoneNumber) {
    return { success: false, message: 'Phone number is required' };
  }
  const result = await findJobByPhone(phoneNumber);
  if (result) {
    const row = result.rowData;
    return {
      success: true,
      found: true,
      job: {
        timestamp: row[0],
        name: row[1],
        email: row[2],
        phone_number: row[3],
        service_type: row[4],
        preferred_time: row[5],
        location_type: row[6],
        location: row[7],
        appointment_status: row[8],
        call_duration: row[9]
      }
    };
  }
  return { success: true, found: false, message: 'No job found for this phone number' };
}

// HANDLER: Reschedule
async function handleReschedule(data) {
  const phoneNumber = data.phone_number;
  if (!phoneNumber) {
    return { success: false, message: 'Phone number is required' };
  }
  const result = await findJobByPhone(phoneNumber);
  if (!result) {
    return { success: false, message: 'No job found for this phone number' };
  }
  const updates = { 'A': getTimestamp(), 'I': 'Rescheduled' };
  if (data.preferred_Time) {
    updates['F'] = data.preferred_Time;
  }
  await updateRow(SHEET_NAMES.JOBS, result.rowIndex, updates);
  return { success: true, message: 'Job rescheduled successfully' };
}

// HANDLER: Cancellation
async function handleCancellation(data) {
  const phoneNumber = data.phone_number;
  if (!phoneNumber) {
    return { success: false, message: 'Phone number is required' };
  }
  const result = await findJobByPhone(phoneNumber);
  if (!result) {
    return { success: false, message: 'No job found for this phone number' };
  }
  const updates = { 'A': getTimestamp(), 'I': 'Cancelled' };
  await updateRow(SHEET_NAMES.JOBS, result.rowIndex, updates);
  return { success: true, message: 'Job cancelled successfully' };
}

// HANDLER: logEmergency
async function handleLogEmergency(data) {
  const row = [
    getTimestamp(),
    data.name || '',
    data.phone_number || '',
    data.location || '',
    data.emergency_details || '',
    data.call_duration || ''
  ];
  await appendRow(SHEET_NAMES.EMERGENCY, row);
  return { success: true, message: 'Emergency logged successfully' };
}

// HANDLER: collectInquiryDetails
async function handleCollectInquiryDetails(data) {
  const row = [
    getTimestamp(),
    data.name || '',
    data.phone_number || '',
    data.location || '',
    data.inquiry_details || data.service_type || '',
    data.call_duration || ''
  ];
  await appendRow(SHEET_NAMES.INQUIRY, row);
  return { success: true, message: 'Inquiry logged successfully' };
}

// MAIN WEBHOOK HANDLER
functions.http('webhook', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { action, data } = req.body;

    if (!action) {
      res.status(400).json({ error: 'Action is required' });
      return;
    }

    let result;
    switch (action) {
      case 'createJobDetails':
        result = await handleCreateJobDetails(data || {});
        break;
      case 'getJob':
        result = await handleGetJob(data || {});
        break;
      case 'reschedule':
      case 'Reschedule_caller_information':
        result = await handleReschedule(data || {});
        break;
      case 'cancellation':
      case 'Cancellation_caller_Information':
        result = await handleCancellation(data || {});
        break;
      case 'logEmergency':
        result = await handleLogEmergency(data || {});
        break;
      case 'collectInquiryDetails':
        result = await handleCollectInquiryDetails(data || {});
        break;
      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});
