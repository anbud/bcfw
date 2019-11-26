const tendermint = require('tendermint-node')
const fs = require('fs-extra')
const { join } = require('path')

export const genValidator = () => tendermint.genValidator()

export default async function initTendermint({
    home,
    ports,
    log,
    genesis,
    privateKey,
    peers,
}) {
    let opts = {
        rpc: {
            laddr: `tcp://0.0.0.0:${ports.rpc}`,
        },
        p2p: {
            laddr: `tcp://0.0.0.0:${ports.p2p}`,
        },
        proxyApp: `tcp://127.0.0.1:${ports.abci}`,
    }

    await tendermint.init(home)

    if (peers && peers.length > 0) {
        let shouldUseAuth = false

        peers.forEach(peer => {
            if (peer.indexOf('@') !== -1) {
                shouldUseAuth = true
            }
        })

        if (!shouldUseAuth) {
            let cfgPath = join(home, 'config', 'config.toml')
            let configToml = fs.readFileSync(cfgPath, 'utf8')
    
            configToml = configToml.replace(
                'auth_enc = true',
                'auth_enc = false'
            )
    
            fs.writeFileSync(cfgPath, configToml)

            const bogusId = '0000000000000000000000000000000000000000'
            peers.forEach((peer, index) => {
                if (peer.indexOf('@') === -1) {
                    peers[index] = [bogusId, peer].join('@')
                }
            })
        }

        opts.p2p.persistentPeers = peers.join(',')
    }

    if (genesis) {
        if (!fs.existsSync(genesis)) {
            throw new Error(`Invalid genesis file provided at ${genesis}.`)
        }
        
        fs.copySync(genesis, join(home, 'config', 'genesis.json'))
    }

    if (privateKey) {
        let privValPath = join(home, 'config', 'priv_validator_key.json')
        
        if (!fs.existsSync(privateKey)) {
            throw new Error(`Invalid private key provided at ${keyPath}.`)
        }
        
        let newValidatorJson = fs.readJsonSync(privateKey)
        let oldValidatorJson = fs.readJsonSync(privValPath)

        if (newValidatorJson.pub_key.value !== oldValidatorJson.pub_key.value) {
            fs.copySync(privateKey, privValPath)
        }
    }

    let killed = false

    let tendermintProcess = tendermint.node(home, opts)

    if (log) {
        tendermintProcess.stdout.pipe(process.stdout)
        tendermintProcess.stderr.pipe(process.stderr)
    }

    tendermintProcess.then(() => {
        if (killed) return
        
        throw new Error('Tendermint exited unexpectedly.')
    })

    await tendermintProcess.synced()
    
    return {
        kill() {
            killed = true

            tendermintProcess.kill()
        },
    }
}
