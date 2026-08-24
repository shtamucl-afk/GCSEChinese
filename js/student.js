// js/student.js
// -----------------------------------------------------------------------------
// Shared helpers for student name management across pages.
// Used by index.html and dashboard.html.
//
// Depends on:
//   - firebase-config.js  (initializes the `db` global)
//   - firebase-app-compat + firebase-firestore-compat SDKs loaded via CDN
// -----------------------------------------------------------------------------

// Sentinel value used to represent the "+ Add new student" option
const ADD_NEW_SENTINEL = '__ADD_NEW__';

/**
 * Read student name from URL ?student= parameter.
 * Returns the decoded name (trimmed) or null if not present.
 */
function getStudentFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('student');
    return name ? name.trim() : null;
}

/**
 * Navigate to the dashboard for a given student.
 */
function navigateToDashboard(studentName) {
    if (!studentName) return;
    const encoded = encodeURIComponent(studentName);
    window.location.href = `dashboard.html?student=${encoded}`;
}

/**
 * Fetch the current list of student names from studentIndex/list.
 * Returns [] if the doc doesn't exist or has no names.
 */
async function fetchStudentList() {
    try {
        const doc = await db.collection('studentIndex').doc('list').get();
        if (doc.exists) {
            return doc.data().names || [];
        }
        return [];
    } catch (err) {
        console.error('Error fetching student list:', err);
        return [];
    }
}

/**
 * Populate a <select> element with student names plus a "+ Add new student" option.
 *
 * @param {HTMLSelectElement} selectEl - the <select> element to populate
 * @param {string|null} currentStudent - if provided, that name is pre-selected
 */
async function populateStudentDropdown(selectEl, currentStudent = null) {
    selectEl.innerHTML = '<option value="">Loading students...</option>';

    const names = await fetchStudentList();

    // Rebuild the option list
    selectEl.innerHTML = '';

    // Placeholder option only when no student is pre-selected
    if (!currentStudent) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Select your name --';
        selectEl.appendChild(placeholder);
    }

    // Real student names
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === currentStudent) {
            opt.selected = true;
        }
        selectEl.appendChild(opt);
    });

    // "+ Add new student" option always at the bottom
    const addNew = document.createElement('option');
    addNew.value = ADD_NEW_SENTINEL;
    addNew.textContent = '+ Add new student';
    selectEl.appendChild(addNew);
}

/**
 * Create a new student in Firestore.
 *   - Creates students/<name> document with empty progress
 *   - Appends the name to studentIndex/list.names (atomic append)
 *
 * @param {string} name - the new student name
 * @returns {Promise<boolean>} true if created successfully, false otherwise
 */
async function addNewStudent(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        alert('Student name cannot be empty.');
        return false;
    }

    try {
        // Duplicate check
        const currentNames = await fetchStudentList();
        if (currentNames.includes(trimmed)) {
            alert(`Student "${trimmed}" already exists. Please pick the existing name from the dropdown.`);
            return false;
        }

        // Create the student document
        await db.collection('students').doc(trimmed).set({
            progress: {},
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });

        // Append name to studentIndex/list.names
        // arrayUnion = atomic append, safer than read-modify-write
        await db.collection('studentIndex').doc('list').set({
            names: firebase.firestore.FieldValue.arrayUnion(trimmed),
        }, { merge: true });

        console.log(`✅ New student created: ${trimmed}`);
        return true;
    } catch (err) {
        console.error('Error adding student:', err);
        alert(`Failed to add student: ${err.message}`);
        return false;
    }
}

/**
 * Handle a change on the student dropdown.
 *   - Placeholder ("")            → do nothing
 *   - Real student name           → do nothing (wait for Start button)
 *   - "+ Add new student"         → prompt, create, navigate
 *
 * Only the "+ Add new student" case triggers immediate action.
 */
async function handleStudentDropdownChange(selectEl) {
    const value = selectEl.value;

    if (value !== ADD_NEW_SENTINEL) {
        // Placeholder or real name — do nothing
        return;
    }

    // "+ Add new student" flow
    const name = prompt('Enter the new student name:');
    if (name === null) {
        // User cancelled
        selectEl.value = '';
        return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
        alert('Student name cannot be empty.');
        selectEl.value = '';
        return;
    }

    const success = await addNewStudent(trimmed);
    if (success) {
        navigateToDashboard(trimmed);
    } else {
        selectEl.value = '';
    }
}

// ------------------------------------------------------------------
// My Notebook helpers
// ------------------------------------------------------------------
const NOTEBOOK_BOOK_ID = '99';
const NOTEBOOK_DEFAULT_PAGE = '01';
const NOTEBOOK_DEFAULT_PAGE_TITLE = 'Main page';

function sanitizeStudentName(name) {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
}

function notebookWordId(student, pageId, traditional) {
    const safeStudent = sanitizeStudentName(student);
    const safePage = String(pageId || NOTEBOOK_DEFAULT_PAGE);
    const safeWord = String(traditional).replace(/[^\u4e00-\u9fff]/g, '');
    return `nb_${safeStudent}_${safePage}_${safeWord}`;
}

async function loadNotebook(student) {
    const doc = await db.collection('students').doc(student).get();
    if (!doc.exists) return {};
    return doc.data().notebook || {};
}

async function loadNotebookPages(student) {
    const doc = await db.collection('students').doc(student).get();
    if (!doc.exists) return { '01': { title: NOTEBOOK_DEFAULT_PAGE_TITLE } };
    const rawPages = doc.data().notebookPages;
    const pages = (rawPages && Object.keys(rawPages).length > 0) ? { ...rawPages } : { '01': { title: NOTEBOOK_DEFAULT_PAGE_TITLE } };
    if (!pages['01']) pages['01'] = { title: NOTEBOOK_DEFAULT_PAGE_TITLE };
    return pages;
}

/**
 * Return notebook pages as [[pageId, page], ...] sorted by `sortOrder`
 * (ascending), falling back to numeric pageId order when `sortOrder`
 * is absent. Used by the dashboard, exercise page, and edit mode so
 * page order is consistent everywhere.
 */
function orderedNotebookPages(pages) {
    return Object.entries(pages || {}).sort((a, b) => {
        const soA = (a[1] && a[1].sortOrder != null) ? Number(a[1].sortOrder) : null;
        const soB = (b[1] && b[1].sortOrder != null) ? Number(b[1].sortOrder) : null;
        if (soA != null && soB != null) {
            if (soA !== soB) return soA - soB;
            return String(a[0]).localeCompare(String(b[0]));
        }
        if (soA != null) return -1;
        if (soB != null) return 1;
        const na = parseInt(a[0], 10);
        const nb = parseInt(b[0], 10);
        const ka = Number.isNaN(na) ? 999 : na;
        const kb = Number.isNaN(nb) ? 999 : nb;
        if (ka !== kb) return ka - kb;
        return String(a[0]).localeCompare(String(b[0]));
    });
}

async function saveNotebookWord(student, entry) {
    const pid = entry.pageId || NOTEBOOK_DEFAULT_PAGE;
    const wordId = notebookWordId(student, pid, entry.traditional);
    entry.pageId = pid;
    // Read-modify-write with nested map (compatible with Streamlit/Pipeline)
    const docRef = db.collection('students').doc(student);
    const doc = await docRef.get();
    const data = doc.exists ? doc.data() : {};
    const notebook = data.notebook || {};
    notebook[wordId] = entry;
    data.notebook = notebook;
    data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.set(data);
    return wordId;
}

async function removeNotebookWord(student, pageId, traditional) {
    const wordId = notebookWordId(student, pageId || NOTEBOOK_DEFAULT_PAGE, traditional);
    // Read-modify-write with nested map (compatible with Streamlit/Pipeline)
    const docRef = db.collection('students').doc(student);
    const doc = await docRef.get();
    if (!doc.exists) return;
    const data = doc.data();
    const notebook = data.notebook || {};
    delete notebook[wordId];
    data.notebook = notebook;
    data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.set(data);
}

/**
 * Create a dispatch document in notebookDispatches/ to trigger the
 * Cloud Function. One doc per page — the CF watches this collection
 * and dispatches one GitHub Actions workflow per doc.
 *
 * @param {string} student - Student name
 * @param {string} pageId - Page ID (e.g. "01")
 * @param {string[]} words - Array of traditional Chinese words to enrich
 * @param {string} context - Optional passage context for AI enrichment
 */
async function dispatchNotebookPage(student, pageId, words, context) {
    if (!words || !words.length) return;
    const safeStudent = sanitizeStudentName(student);
    const ts = Date.now();
    const docId = `${safeStudent}_${pageId}_${ts}`;
    try {
        await db.collection('notebookDispatches').doc(docId).set({
            student: student,
            page: pageId,
            words: words,
            context: context || '',
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[dispatchNotebookPage] Created dispatch doc: ${docId}`);
    } catch (err) {
        console.error(`[dispatchNotebookPage] Failed for ${docId}:`, err);
    }
}

