const REPORT_SIZE = 32;
const PAYLOAD_SIZE = 23;
const REPORT_MAGIC = 0x5A;
const REQUEST_TIMEOUT_MS = 10000;
const VID = 0xFEED;
const PID = 0x0000;
const USAGE_PAGE = 0xFF60;
const USAGE = 0x61;

const CMD_PING = 0x01;
const RSP_PONG = 0x81;
const PROTOCOL_VERSION = 0x02;
const CMD_BEGIN_SESSION = 0x10;
const CMD_SELECT_NOTE = 0x11;
const CMD_READ_CHUNK = 0x12;
const CMD_HEARTBEAT = 0x13;
const CMD_END_SESSION = 0x14;
const CMD_READ_NAME = 0x15;
const CMD_LIST_NOTE = 0x16;
const CMD_BEGIN_WRITE = 0x20;
const CMD_WRITE_CHUNK = 0x21;
const CMD_COMMIT_WRITE = 0x22;
const CMD_CANCEL_WRITE = 0x23;

const RSP_BEGIN_SESSION = 0x90;
const RSP_SELECT_NOTE = 0x91;
const RSP_READ_CHUNK = 0x92;
const RSP_HEARTBEAT = 0x93;
const RSP_END_SESSION = 0x94;
const RSP_READ_NAME = 0x95;
const RSP_LIST_NOTE = 0x96;
const RSP_ERROR = 0xFF;
const RSP_BEGIN_WRITE = 0xA0;
const RSP_WRITE_CHUNK = 0xA1;
const RSP_COMMIT_WRITE = 0xA2;
const RSP_CANCEL_WRITE = 0xA3;

const statusMessages = [
  'OK',
  'No active browser session',
  'No note is selected',
  'Invalid request',
  'microSD card error',
  'Transfer offset mismatch',
  'Size or checksum mismatch',
  'No USB host detected',
  'Zotter is busy'
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const editor = document.querySelector('#editor');
const status = document.querySelector('#status');
const editorTitle = document.querySelector('#editor-title');
const appbar = document.querySelector('#appbar');
const connectView = document.querySelector('#connect-view');
const sessionNav = document.querySelector('#session-nav');
const fileCrumb = document.querySelector('#file-crumb');
const workspace = document.querySelector('#workspace');
const directoryView = document.querySelector('#directory-view');
const editorView = document.querySelector('#editor-view');
const notesList = document.querySelector('#notes-list');
const buttons = {
  connect: document.querySelector('#connect'),
  back: document.querySelector('#back'),
  save: document.querySelector('#save'),
  copy: document.querySelector('#copy'),
  end: document.querySelector('#end')
};

let device = null;
let filename = '';
let notes = [];
let selectedNoteIndex = -1;
let cleanEditorValue = '';
let pending = null;
let requestChain = Promise.resolve();
let heartbeat = null;
let statusTimer = null;
let operationBusy = false;

function setStatus(message) {
  clearTimeout(statusTimer);
  status.textContent = message;
  status.hidden = !message;
  statusTimer = message
    ? setTimeout(() => {
        status.hidden = true;
        status.textContent = '';
        statusTimer = null;
      }, 5000)
    : null;
}

function showView(view) {
  const connected = view !== 'connect';
  connectView.hidden = connected;
  appbar.hidden = !connected;
  sessionNav.hidden = !connected;
  workspace.hidden = !connected;
  document.body.classList.toggle('is-connected', connected);
  directoryView.hidden = view !== 'directory';
  editorView.hidden = view !== 'editor';
  fileCrumb.hidden = view !== 'editor';
  if (view === 'editor') {
    resizeEditor();
    editor.focus();
  }
}

function showEditor() {
  showView('editor');
  setStatus(`${filename} is open. Ctrl+S overwrites it on Zotter.`);
}

function resizeEditor() {
  if (editorView.hidden) return;
  editor.style.height = '0';
  const editorTop = editor.getBoundingClientRect().top + window.scrollY;
  const availableHeight = Math.max(
    320,
    window.innerHeight - editorTop - 80
  );
  editor.style.height = `${Math.max(editor.scrollHeight, availableHeight)}px`;
}

function readU32(bytes, offset = 0) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
  bytes[offset + 2] = (value >>> 16) & 0xFF;
  bytes[offset + 3] = (value >>> 24) & 0xFF;
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeReport(command, value = 0, payload = new Uint8Array()) {
  if (payload.length > PAYLOAD_SIZE) {
    throw new Error('Raw HID payload is too large');
  }

  const report = new Uint8Array(REPORT_SIZE);
  report[0] = REPORT_MAGIC;
  report[1] = PROTOCOL_VERSION;
  report[2] = command;
  writeU32(report, 4, value);
  report[8] = payload.length;
  report.set(payload, 9);
  return report;
}

function receiveReport(event) {
  const bytes = new Uint8Array(
    event.data.buffer,
    event.data.byteOffset,
    event.data.byteLength
  );

  if (!pending ||
      bytes[0] !== REPORT_MAGIC ||
      bytes[1] !== PROTOCOL_VERSION) {
    return;
  }

  if (bytes[2] !== pending.expected && bytes[2] !== RSP_ERROR) {
    return;
  }

  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  current.resolve(bytes.slice());
}

async function transactNow(report, expected, checkStatus = true) {
  if (!device?.opened) {
    throw new Error('Zotter is not connected');
  }

  if (pending) {
    throw new Error('Another request is still pending');
  }

  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error('Zotter did not respond'));
    }, REQUEST_TIMEOUT_MS);

    pending = { expected, resolve, reject, timer };
  });

  try {
    await device.sendReport(0, report);
  } catch (error) {
    clearTimeout(pending?.timer);
    pending = null;
    throw error;
  }

  const result = await response;
  const responseStatus = result[3];
  if (result[2] === RSP_ERROR || (checkStatus && responseStatus !== 0)) {
    throw new Error(
      (responseStatus && statusMessages[responseStatus]) ||
      `Zotter error ${responseStatus}`
    );
  }
  return result;
}

function transact(report, expected, checkStatus = true) {
  const result = requestChain.then(
    () => transactNow(report, expected, checkStatus)
  );
  requestChain = result.catch(() => {});
  return result;
}

async function readChunked(command, expected, length, onProgress) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    onProgress?.(offset);
    const response = await transact(makeReport(command, offset), expected);
    const responseOffset = readU32(response, 4);
    const count = response[8];
    if (responseOffset !== offset || count === 0 ||
        offset + count > length) {
      throw new Error('Zotter returned an invalid chunk');
    }
    bytes.set(response.slice(9, 9 + count), offset);
    offset += count;
  }
  return bytes;
}

async function readName(length) {
  return textDecoder.decode(
    await readChunked(CMD_READ_NAME, RSP_READ_NAME, length)
  );
}

function renderNoteList() {
  notesList.replaceChildren();
  if (notes.length === 0) {
    const empty = document.createElement('span');
    empty.textContent = 'No notes';
    notesList.append(empty);
    return;
  }

  notes.forEach((note, index) => {
    const link = document.createElement('a');
    link.className = 'pull-note-link';
    link.href = '#';
    link.textContent = note;
    link.addEventListener('click', event => {
      event.preventDefault();
      openNote(index);
    });
    notesList.append(link);
  });
}

async function enumerateNotes(count) {
  notes = [];
  for (let index = 0; index < count; index++) {
    const response = await transact(
      makeReport(CMD_LIST_NOTE, index),
      RSP_LIST_NOTE
    );
    notes.push(await readName(readU32(response, 4)));
  }
  renderNoteList();
}

function hasUnsavedChanges() {
  return selectedNoteIndex >= 0 && editor.value !== cleanEditorValue;
}

function updateSaveIndicator() {
  buttons.save.classList.toggle('has-changes', hasUnsavedChanges());
}

function clearSelectedNote() {
  selectedNoteIndex = -1;
  filename = '';
  cleanEditorValue = '';
  editor.value = '';
  editor.style.height = '';
  editor.disabled = true;
  editorTitle.textContent = 'Select a note';
  buttons.save.disabled = true;
  buttons.copy.disabled = true;
  updateSaveIndicator();
}

function showDirectory() {
  if (operationBusy) return;
  if (hasUnsavedChanges() &&
      !confirm('Discard unsaved changes and return to Directory?')) {
    return;
  }

  editor.value = cleanEditorValue;
  updateSaveIndicator();
  showView('directory');
  setStatus('Select a note.');
}

async function openNote(index) {
  if (operationBusy) return;
  if (index === selectedNoteIndex) {
    showEditor();
    return;
  }
  if (hasUnsavedChanges() &&
      !confirm('Discard unsaved changes and open another note?')) {
    return;
  }

  operationBusy = true;
  buttons.end.disabled = true;
  let selectionChanged = false;
  try {
    const name = notes[index];
    setStatus(`Opening ${name}…`);
    const metadata = await transact(
      makeReport(CMD_SELECT_NOTE, index),
      RSP_SELECT_NOTE
    );
    selectionChanged = true;
    if (metadata[8] < 8) {
      throw new Error('Zotter returned invalid file information');
    }

    const size = readU32(metadata, 4);
    const expectedCrc = readU32(metadata, 9);
    const file = await readChunked(
      CMD_READ_CHUNK,
      RSP_READ_CHUNK,
      size,
      offset => setStatus(
        `Reading ${name}: ${Math.floor(offset * 100 / size)}%`
      )
    );

    if (crc32(file) !== expectedCrc) {
      throw new Error('Downloaded note failed its checksum');
    }

    filename = name;
    selectedNoteIndex = index;
    editor.value = textDecoder.decode(file);
    cleanEditorValue = editor.value;
    updateSaveIndicator();
    editorTitle.textContent = filename;
    editor.disabled = false;
    buttons.save.disabled = false;
    buttons.copy.disabled = false;
    showEditor();
  } catch (error) {
    if (selectionChanged) {
      clearSelectedNote();
      showView('directory');
    }
    setStatus(`Could not open note: ${error.message}`);
  } finally {
    operationBusy = false;
    buttons.end.disabled = !device?.opened;
  }
}

async function closeDevice(message) {
  const currentDevice = device;
  device = null;
  try {
    if (currentDevice?.opened) await currentDevice.close();
  } catch {}
  resetInterface();
  setStatus(message);
}

async function connect() {
  if (!('hid' in navigator)) {
    setStatus('WebHID is unavailable. Use desktop Chrome or Edge.');
    return;
  }

  let sessionStarted = false;
  buttons.connect.disabled = true;
  try {
    const devices = await navigator.hid.requestDevice({
      filters: [{
        vendorId: VID,
        productId: PID,
        usagePage: USAGE_PAGE,
        usage: USAGE
      }]
    });
    if (!devices.length) {
      buttons.connect.disabled = false;
      return;
    }

    device = devices[0];
    if (!device.opened) await device.open();
    device.addEventListener('inputreport', receiveReport);

    setStatus('Testing the Pico WebHID connection…');
    try {
      await transact(makeReport(CMD_PING), RSP_PONG, false);
    } catch (error) {
      throw new Error(
        `Pico WebHID reply failed: ${error.message}. ` +
        'Reflash the QMK firmware or try Chrome/Edge.'
      );
    }

    setStatus('Starting browser session…');
    const session = await transact(
      makeReport(CMD_BEGIN_SESSION),
      RSP_BEGIN_SESSION
    );
    sessionStarted = true;
    await enumerateNotes(readU32(session, 4));

    showView('directory');
    buttons.end.disabled = false;
    startHeartbeat();
    setStatus('Select a note.');
  } catch (error) {
    if (sessionStarted && device?.opened) {
      try {
        await transact(
          makeReport(CMD_END_SESSION),
          RSP_END_SESSION
        );
      } catch {}
    }
    await closeDevice(`Connection failed: ${error.message}`);
  }
}

async function save() {
  if (!device?.opened || operationBusy || selectedNoteIndex < 0) return;
  operationBusy = true;
  buttons.save.disabled = true;
  buttons.end.disabled = true;

  try {
    const bytes = textEncoder.encode(editor.value);
    const checksum = crc32(bytes);
    const checksumPayload = new Uint8Array(4);
    writeU32(checksumPayload, 0, checksum);

    setStatus(`Preparing to save ${filename}…`);
    await transact(
      makeReport(CMD_BEGIN_WRITE, bytes.length, checksumPayload),
      RSP_BEGIN_WRITE
    );

    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.slice(offset, offset + PAYLOAD_SIZE);
      const response = await transact(
        makeReport(CMD_WRITE_CHUNK, offset, chunk),
        RSP_WRITE_CHUNK
      );
      const nextOffset = readU32(response, 4);
      if (nextOffset !== offset + chunk.length) {
        throw new Error('Zotter acknowledged the wrong write offset');
      }
      offset = nextOffset;
      setStatus(
        `Saving ${filename}: ${Math.floor(offset * 100 / bytes.length)}%`
      );
    }

    await transact(
      makeReport(CMD_COMMIT_WRITE),
      RSP_COMMIT_WRITE
    );
    cleanEditorValue = editor.value;
    updateSaveIndicator();
    setStatus(`${filename} saved to Zotter.`);
  } catch (error) {
    setStatus(`Save failed: ${error.message}`);
    try {
      await transact(
        makeReport(CMD_CANCEL_WRITE),
        RSP_CANCEL_WRITE
      );
    } catch {}
  } finally {
    operationBusy = false;
    buttons.save.disabled = selectedNoteIndex < 0;
    buttons.end.disabled = !device?.opened;
    editor.focus();
  }
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(editor.value);
    setStatus(`${filename} copied to the clipboard.`);
  } catch {
    editor.select();
    setStatus('Text selected. Use the browser Copy command.');
  }
  editor.focus();
}

function startHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = setInterval(async () => {
    if (!device?.opened || operationBusy) return;
    try {
      await transact(makeReport(CMD_HEARTBEAT), RSP_HEARTBEAT);
    } catch (error) {
      await closeDevice(`Connection lost: ${error.message}`);
    }
  }, 2000);
}

function resetInterface() {
  clearInterval(heartbeat);
  heartbeat = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Zotter disconnected'));
    pending = null;
  }
  requestChain = Promise.resolve();
  operationBusy = false;
  notes = [];
  notesList.replaceChildren();
  clearSelectedNote();
  buttons.end.disabled = true;
  buttons.connect.disabled = false;
  showView('connect');
}

async function endSession() {
  if (operationBusy) return;
  if (hasUnsavedChanges() &&
      !confirm('End the session and discard unsaved changes?')) {
    return;
  }

  operationBusy = true;
  try {
    if (device?.opened) {
      await transact(makeReport(CMD_END_SESSION), RSP_END_SESSION);
    }
    await closeDevice('Session ended. Zotter has returned to Focus mode.');
  } catch (error) {
    operationBusy = false;
    setStatus(`Could not end session: ${error.message}`);
  }
}

editor.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

editor.addEventListener('input', () => {
  updateSaveIndicator();
  resizeEditor();
});

window.addEventListener('resize', resizeEditor);

window.addEventListener('beforeunload', event => {
  if (hasUnsavedChanges()) event.preventDefault();
});

navigator.hid?.addEventListener('disconnect', event => {
  if (event.device === device) {
    closeDevice('Zotter disconnected.');
  }
});

buttons.connect.addEventListener('click', connect);
buttons.back.addEventListener('click', showDirectory);
buttons.save.addEventListener('click', save);
buttons.copy.addEventListener('click', copyText);
buttons.end.addEventListener('click', endSession);
