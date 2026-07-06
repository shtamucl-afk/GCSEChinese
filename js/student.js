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