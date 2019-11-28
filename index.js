import { join } from 'path'
import { homedir } from 'os'

const createABCIServer = require('./lib/abci')
const { initTendermint } = require('./lib/tendermint')
const createStateMachine = require('./lib/stateMachine')

const { randomBytes, createHash } = require('crypto')
const fs = require('fs-extra')
const getPort = require('get-port')
const DJSON = require('deterministic-json')
const level = require('level')
const merk = require('merk')

class BCFW {
    constructor(config) {
        this.application = createStateMachine(config)

        this.log = config.log
        this.initialState = config.initialState
        this.privateKey = config.privateKey
        this.genesis = config.genesis
        this.peers = config.peers
        this.appHome = join(homedir(), '.bcfw', 'networks')

        this.setHome()

        Object.assign(this, this.application)
    }

    async assignPorts() {
        this.ports = {
            abci: this.config.abciPort || (await getPort()),
            p2p: this.config.p2pPort || (await getPort()),
            rpc: this.config.rpcPort || (await getPort()),
        }
    }

    setGCI() {
        this.GCI = createHash('sha256')
            .update(this.genesis)
            .digest('hex')
    }

    getAppInfo() {
        return {
            ports: this.ports,
            GCI: this.GCI,
            genesis: this.genesis,
            home: this.home,
        }
    }

    setGenesis() {
        if (!this.genesis) {
            this.genesis = join(this.home, 'config', 'genesis.json')
        }

        let genesisJSON = fs.readFileSync(this.genesis, 'utf8')
        this.genesis = DJSON.stringify(JSON.parse(genesisJSON))
    }

    setHome() {
        if (this.config.genesis && this.config.privateKey) {
            this.home = join(
                this.appHome,
                createHash('sha256')
                    .update(fs.readFileSync(this.config.genesis))
                    .update(fs.readFileSync(this.config.privateKey))
                    .digest('hex')
            )
        } else if (this.config.genesis && !this.config.privateKey) {
            this.home = join(
                this.appHome,
                createHash('sha256')
                    .update(fs.readFileSync(this.config.genesis))
                    .digest('hex')
            )
        } else {
            this.home = join(this.appHome, randomBytes(16).toString('hex'))
        }
    }

    async start() {
        await this.assignPorts()
        await fs.mkdirp(this.home)

        this.db = level(join(this.home, 'state.db'))
        this.state = await merk(this.db)

        this.stateMachine = this.application.compile(this.state)

        this.abciServer = createABCIServer(
            this.state,
            this.stateMachine,
            this.initialState,
            this.home
        )
        this.abciServer.listen(this.ports.abci)

        this.tendermintProcess = await createTendermintProcess({
            home: this.home,
            ports: this.ports,
            privateKey: this.privateKey,
            genesis: this.genesis,
            peers: this.peers,
            log: this.log,
        })

        this.setGenesis()
        this.setGCI()

        let appInfo = this.getAppInfo()

        return appInfo
    }
}

let App = config => new BCFW(config)

const wrapper = obj => {
    let callback = null

    if (typeof obj === 'function') {
        callback = obj
    } else {
        callback = (req, cb) => {
            cb(null, obj)
        }
    }

    return (req, res, next) => {
        callback(req, (err, options) => {
            if (err) {
                next(err)
            } else {
            }
        })
    }
}

module.exports = wrapper
