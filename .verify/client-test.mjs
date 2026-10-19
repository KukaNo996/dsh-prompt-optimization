/**
 * Static smoke test for the browser half: evaluates the real client.js factory with a
 * minimal React stub, then applies the plugin against a fake Client ctx and checks that
 * both slot registrations are made with the documented options.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

const requireStub = (id) => {
  if (id === 'react') {
    return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      Fragment: 'Fragment',
    }
  }
  throw new Error(`unexpected require(${id})`)
}

let loaded
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (entry) => {
        loaded = entry
      },
    },
  },
  location: { origin: 'http://127.0.0.1:57296' },
  fetch: async () => {
    throw new Error('fetch must not run during static evaluation')
  },
  console,
  setTimeout,
  clearTimeout,
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

check('module loader id is the package name', loaded?.id === 'dsh-promt-refine', loaded?.id)
check('factory is a function', typeof loaded?.factory === 'function')
const exports = loaded.factory(requireStub)
check('client exports inject', Array.isArray(exports?.inject) && exports.inject.includes('slots') && exports.inject.includes('locale'), exports?.inject)
check('client exports apply', typeof exports?.apply === 'function')
check('slot components are functions', typeof exports?.apply === 'function')

const registrations = []
const injected = []
const ctx = {
  effect: (callback) => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  slots: {
    inject: (key, callback) => {
      injected.push(key)
      callback()
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    bind: () => (key) => key,
    register: () => () => {},
  },
}

exports.apply(ctx)

check('two slot registrations', registrations.length === 2, registrations.length)
const toolbar = registrations.find((entry) => entry.options.name === 'conversation.input.right')
const section = registrations.find((entry) => entry.options.name === 'settings.section')
check('toolbar registration sits before the model seat', toolbar?.options.id === 'dsh-promt-refine' && toolbar.options.order === 20, toolbar?.options)
check('toolbar registration is localized', toolbar?.options.locale === 'dsh-promt-refine', toolbar?.options)
check('toolbar component is a function', typeof toolbar?.component === 'function')
check('settings registration', section?.options.id === 'dsh-promt-refine' && section.options.order === 50, section?.options)
check('settings label thunk resolves', typeof section?.options.label === 'function' && typeof section.options.label() === 'string', section?.options.label)
check('settings component is a function', typeof section?.component === 'function')
check('slots.inject waits for both owners', injected.includes('conversation.input.right') && injected.includes('settings.section'), injected)
check('no bottom-dock registration remains', !registrations.some((entry) => entry.options.name === 'conversation.composer.dock'))

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
