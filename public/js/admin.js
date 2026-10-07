// সবমিলবে admin — photo resizing and confirmations
(function () {
  'use strict';

  // Ask before destructive actions
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  var form = document.querySelector('[data-product-form]');
  if (!form) return;
  var fileInput = form.querySelector('[data-photo]');
  var hidden = form.querySelector('[data-image]');
  var preview = form.querySelector('[data-preview]');
  var removeBox = form.querySelector('[data-remove-image]');
  var saveBtn = form.querySelector('[data-save]');
  var original = preview.innerHTML;

  // Shrink photos in the browser so uploads are fast and pages stay light.
  function resize(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('bad image')); };
        img.onload = function () {
          var max = 1000;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;
    saveBtn.disabled = true;
    preview.innerHTML = '<span class="muted">ছবি তৈরি হচ্ছে…</span>';
    resize(file).then(function (dataUrl) {
      hidden.value = dataUrl;
      preview.innerHTML = '<img alt="নতুন ছবি">';
      preview.querySelector('img').src = dataUrl;
      if (removeBox) removeBox.checked = false;
    }).catch(function () {
      preview.innerHTML = original;
      alert('এই ফাইলটি ছবি হিসেবে পড়া যায়নি। JPG বা PNG ছবি দিন।');
    }).then(function () { saveBtn.disabled = false; });
  });

  if (removeBox) {
    removeBox.addEventListener('change', function () {
      if (removeBox.checked) {
        hidden.value = '__remove__';
        fileInput.value = '';
        preview.innerHTML = '<span class="emoji">' + (form.elements.emoji.value || '📦') + '</span>';
      } else {
        hidden.value = '';
        preview.innerHTML = original;
      }
    });
  }
})();
