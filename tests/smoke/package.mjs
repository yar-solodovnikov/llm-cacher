// Fails when npm would rewrite package.json while publishing. npm only prints a warning and
// carries on — e.g. newer npm drops a `bin` entry written as "./dist/cli.cjs", which silently
// published a package without its CLI.
import { spawnSync } from 'node:child_process'

// shell: needed on Windows, where npm is npm.cmd
const result = spawnSync('npm publish --dry-run --ignore-scripts', { encoding: 'utf8', shell: true })
const output = `${result.stdout}\n${result.stderr}`

const problems = output.split('\n').filter(line => /auto-corrected|invalid and removed|No bin file found/.test(line))

if (problems.length > 0) {
  console.error('npm would modify package.json on publish:\n' + problems.join('\n'))
  console.error('Run "npm pkg fix" and commit the result.')
  process.exitCode = 1
} else if (!/Tarball Contents/.test(output)) {
  console.error('npm publish --dry-run did not produce a tarball:\n' + output)
  process.exitCode = 1
} else {
  console.log('  ok   package.json is published as written')
}
