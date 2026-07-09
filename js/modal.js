/**
 * modal.js — Shared modal dialog utility for confirmation and alert popups.
 *
 * Replaces the native window.confirm() and window.alert() browser dialogs with
 * a styled in-window modal matching the app design system.
 *
 * Usage:
 *   showConfirm('Set 49 words to L1 Read?').then(confirmed => {
 *     if (confirmed) doTheAction();
 *   });
 *
 *   showAlert('Please select a student first.').then(() => {
 *     // OK button clicked
 *   });
 *
 * Introduced in M8.3e.
 */
(function() {
  // ------------------------------------------------------------------
  // Inject styles once on load
  // ------------------------------------------------------------------
  const MODAL_STYLES = `
    .app-modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(30, 58, 95, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      opacity: 0;
      transition: opacity 0.15s ease-out;
      padding: 20px;
    }
    .app-modal-backdrop.visible {
      opacity: 1;
    }
    .app-modal-dialog {
      background-color: #F5EFE6;
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(30, 58, 95, 0.25);
      border: 1px solid rgba(30, 58, 95, 0.1);
      transform: translateY(8px);
      transition: transform 0.15s ease-out;
      font-family: 'Inter', system-ui, sans-serif;
      color: #1E3A5F;
    }
    .app-modal-backdrop.visible .app-modal-dialog {
      transform: translateY(0);
    }
    .app-modal-message {
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 20px 0;
      color: #1E3A5F;
    }
    .app-modal-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .app-modal-btn {
      padding: 8px 20px;
      font-size: 14px;
      cursor: pointer;
      border-radius: 8px;
      font-family: inherit;
      font-weight: 600;
      transition: opacity 0.15s, background-color 0.15s;
      border: 1px solid;
      min-width: 80px;
    }
    .app-modal-btn:hover {
      opacity: 0.88;
    }
    .app-modal-btn.confirm {
      background-color: #1E3A5F;
      color: #F5EFE6;
      border-color: #1E3A5F;
    }
    .app-modal-btn.cancel {
      background-color: transparent;
      color: #1E3A5F;
      border-color: rgba(30, 58, 95, 0.3);
    }
    .app-modal-btn.cancel:hover {
      background-color: rgba(30, 58, 95, 0.06);
    }
    @media (max-width: 500px) {
      .app-modal-dialog {
        padding: 20px 22px;
      }
      .app-modal-message {
        font-size: 14px;
      }
      .app-modal-buttons {
        flex-direction: column-reverse;
      }
      .app-modal-btn {
        width: 100%;
      }
    }
  `;

  // Inject styles into head
  if (!document.getElementById('app-modal-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'app-modal-styles';
    styleEl.textContent = MODAL_STYLES;
    document.head.appendChild(styleEl);
  }

  // ------------------------------------------------------------------
  // Core modal function
  // ------------------------------------------------------------------
  function createModal(message, options) {
    const opts = options || {};
    const showCancel = opts.showCancel !== false;
    const confirmLabel = opts.confirmLabel || 'OK';
    const cancelLabel = opts.cancelLabel || 'Cancel';

    return new Promise((resolve) => {
      // Backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'app-modal-backdrop';

      // Dialog
      const dialog = document.createElement('div');
      dialog.className = 'app-modal-dialog';

      // Message
      const msgEl = document.createElement('div');
      msgEl.className = 'app-modal-message';
      msgEl.textContent = message;
      dialog.appendChild(msgEl);

      // Buttons container
      const btnRow = document.createElement('div');
      btnRow.className = 'app-modal-buttons';

      // Cancel button (only for confirmations)
      let cancelBtn = null;
      if (showCancel) {
        cancelBtn = document.createElement('button');
        cancelBtn.className = 'app-modal-btn cancel';
        cancelBtn.textContent = cancelLabel;
        btnRow.appendChild(cancelBtn);
      }

      // Confirm/OK button
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'app-modal-btn confirm';
      confirmBtn.textContent = confirmLabel;
      btnRow.appendChild(confirmBtn);

      dialog.appendChild(btnRow);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      // Focus the confirm button by default
      setTimeout(() => confirmBtn.focus(), 0);

      // Animate in
      requestAnimationFrame(() => {
        backdrop.classList.add('visible');
      });

      // Cleanup + resolve
      function close(result) {
        backdrop.classList.remove('visible');
        setTimeout(() => {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          document.removeEventListener('keydown', keyHandler);
          resolve(result);
        }, 150);
      }

      // Button handlers
      confirmBtn.addEventListener('click', () => close(true));
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => close(false));
      }

      // Backdrop click = cancel
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(showCancel ? false : true);
      });

      // Escape key = cancel
      function keyHandler(e) {
        if (e.key === 'Escape') {
          close(showCancel ? false : true);
        } else if (e.key === 'Enter') {
          close(true);
        }
      }
      document.addEventListener('keydown', keyHandler);
    });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Show a confirmation dialog with OK and Cancel buttons.
   * Returns a Promise resolving to true if OK clicked, false if Cancel/Escape.
   */
  window.showConfirm = function(message, options) {
    return createModal(message, options);
  };

  /**
   * Show an alert dialog with just OK button.
   * Returns a Promise resolving to true when OK is clicked.
   */
  window.showAlert = function(message, options) {
    const opts = Object.assign({}, options || {}, { showCancel: false });
    return createModal(message, opts);
  };
})();