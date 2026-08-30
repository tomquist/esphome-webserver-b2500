import { html, css, LitElement } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import cssTab from "./css/tab";
import "./input-modal";
import "./wattage-status-box";

// Maximum number of B2500 storages the dashboard will render.
export const MAX_STORAGES = 9;

// A state event parsed into the pieces the dashboard needs: which storage
// (sub-)device it belongs to, the normalized sensor key, the raw event data and
// the path used to POST control actions back to the device.
interface ParsedEntity {
  device: string; // sub-device name, or "#<index>" for legacy object ids
  domain: string; // sensor | switch | number | binary_sensor | text_sensor | ...
  key: string; // normalized sensor key, e.g. "depth_of_discharge"
  actionBase: string; // POST target relative to the base path (no leading slash)
  data: any;
}

// Sensor keys the storage card understands. Also used to recognize which
// sub-devices are B2500 storages worth rendering a card for.
export const KNOWN_STORAGE_KEYS = new Set<string>([
  "pv_1_-_active", "pv_2_-_active", "in_1_-_power", "in_2_-_power", "scene",
  "out_1_-_power", "out_2_-_power", "total_power_out", "battery_level",
  "battery_capacity", "last_response", "depth_of_discharge",
  "discharge_threshold", "temperature_1", "temperature_2", "out_1_-_active",
  "out_2_-_active", "generation", "name", "device_type", "device_id",
  "mac_address", "ble_connected", "wifi_connected", "mqtt_connected",
]);

// Sanitize an ESPHome entity name to its object-id form (lowercase; runs of
// characters outside [a-z0-9-] become "_"), then strip the legacy
// "B2500 - N - Store:" prefix (which sanitizes to a leading "...__") so that
// both legacy and simplified entity names collapse to the same key, e.g.
// "depth_of_discharge".
function sanitizeKey(rawName: string): string {
  // ESPHome replaces every character outside [a-z0-9_-] with "_" individually
  // (no run collapsing), so "Store: Depth of Discharge" -> "store__depth_of...".
  // The doubled underscore from the legacy ": " separator is what lets us strip
  // the "B2500 - N - Store:" prefix back down to the bare sensor key.
  let s = rawName.toLowerCase().replace(/[^a-z0-9-]/g, "_");
  const sep = s.lastIndexOf("__");
  if (sep >= 0) s = s.slice(sep + 2);
  return s.replace(/^_+|_+$/g, "");
}

const LEGACY_ID_RE =
  /^(sensor|switch|text_sensor|text|number|binary_sensor|button)-b2500_-_(\d+)_-_.*__(.*)$/;

// Turn a raw state event into a ParsedEntity, or null if it is not a B2500
// storage entity. Prefers the hierarchical "domain/device/name" id, so it works
// with ESPHome sub-devices and simplified entity names; falls back to the legacy
// object-id format ("<domain>-b2500_-_<n>_-_<store>__<key>") for older firmware.
export function parseStorageEntity(data: any): ParsedEntity | null {
  if (data == null || typeof data !== "object") return null;

  // ESPHome up to 2026.7 sends the hierarchical form as "name_id" alongside the
  // object-id "id"; 2026.8 dropped "name_id" and moved that form into "id".
  // Object ids never contain a slash, so the slash tells the two apart.
  const nameId: unknown = data.name_id ?? data.id;
  if (typeof nameId === "string" && nameId.includes("/")) {
    const parts = nameId.split("/");
    // Sub-device entities are domain/device/name (>= 3 parts). Entities without
    // a device (domain/name) are global, not per-storage, and are ignored.
    if (parts.length >= 3) {
      const domain = parts[0];
      const device = parts[1];
      const rawName = parts.slice(2).join("/");
      return {
        device,
        domain,
        key: sanitizeKey(rawName),
        // Hierarchical endpoint; required because simplified object ids collide
        // across devices (every storage exposes e.g. "out_1_-_active").
        actionBase: `${domain}/${encodeURIComponent(device)}/${encodeURIComponent(
          rawName
        )}`,
        data,
      };
    }
    return null;
  }

  const id: unknown = data.id;
  if (typeof id === "string") {
    const m = id.match(LEGACY_ID_RE);
    if (m) {
      const domain = m[1];
      // Legacy object ids already embed the storage, so they are unique and can
      // be posted to directly.
      return {
        device: `#${m[2]}`,
        domain,
        key: m[3],
        actionBase: `${domain}/${id.slice(domain.length + 1)}`,
        data,
      };
    }
  }
  return null;
}

@customElement("solar-storage-ui")
export class SolarStorageUI extends LitElement {
  // The storage (sub-)device this card renders (a sub-device name, or "#<index>"
  // for legacy object ids).
  @property({ type: String }) device = "";
  // All known entities for this device, keyed by sensor key. Supplied by the
  // container so the card never subscribes to the event stream itself and
  // therefore cannot miss the initial burst of states.
  @property({ attribute: false }) entities: Map<string, ParsedEntity> = new Map();
  // Reflected so the container grid can collapse storages that have not
  // reported enough data to render yet (see :host(:not([active])) below).
  @property({ type: Boolean, reflect: true }) active = false;

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("entities")) {
      this.entities.forEach((p, key) => this.applyEntity(key, p));
      this.active = this.deviceType != null;
    }
  }

  private applyEntity(id: string, p: ParsedEntity) {
    const data = p.data;
    switch (id) {
        case `pv_1_-_active`:
          this.pv1Active = data.value;
          break;
        case `pv_2_-_active`:
          this.pv2Active = data.value;
          break;
        case `in_1_-_power`:
          this.pv1Power = data.value;
          break;
        case `in_2_-_power`:
          this.pv2Power = data.value;
          break;
        case `scene`:
          this.sunlightStatus = data.value;
          break;
        case `out_1_-_power`:
          this.outputPower1 = data.value;
          break;
        case `out_2_-_power`:
          this.outputPower2 = data.value;
          break;
        case `total_power_out`:
          this.outputTotal = data.value;
          break;
        case `battery_level`:
          this.batteryPercentage = data.value;
          break;
        case `battery_capacity`:
          this.energyStored = data.value;
          break;
        case `last_response`:
          this.lastUpdate = data.value;
          break;
        case `depth_of_discharge`:
          this.dod = data.value;
          this.dodMin = data.min_value;
          this.dodMax = data.max_value;
          this.setDoD = (dod: number) => doAction(p.actionBase, "set?value=" + dod);
          break;
        case `discharge_threshold`:
          this.dischargeThreshold = data.value;
          this.dischargeThresholdMin = data.min_value;
          this.dischargeThresholdMax = data.max_value;
          this.setDischargeThreshold = (threshold: number) =>
            doAction(p.actionBase, "set?value=" + threshold);
          break;
        case "temperature_1":
          this.temperature1 = data.value;
          break;
        case "temperature_2":
          this.temperature2 = data.value;
          break;
        case "out_1_-_active":
          this.outputEnabled1 = data.value;
          // "Out X - Active" is exposed both as a read-only binary_sensor and
          // as a controllable switch sharing the same object id. Only the
          // switch entity can be toggled, so drive the action from it (its
          // actionBase points at the switch endpoint).
          if (p.domain === "switch") {
            this.toggleOutput1 =
              data.value != null
                ? () =>
                    doAction(
                      p.actionBase,
                      data.value === true ? "turn_off" : "turn_on"
                    )
                : undefined;
          }
          break;
        case "out_2_-_active":
          this.outputEnabled2 = data.value;
          if (p.domain === "switch") {
            this.toggleOutput2 =
              data.value != null
                ? () =>
                    doAction(
                      p.actionBase,
                      data.value === true ? "turn_off" : "turn_on"
                    )
                : undefined;
          }
          break;
        case `generation`:
          this.deviceGeneration = data.value;
          break;
        case `name`:
          this.deviceName = data.value;
          break;
        case `device_type`:
          this.deviceType = data.value;
          break;
        case `device_id`:
          this.deviceId = data.value;
          break;
        case "mac_address":
          this.mac = data.value;
          break;
        case "ble_connected":
          this.bluetooth = data.value;
          break;
        case "wifi_connected":
          this.wifi = data.value;
          break;
        case "mqtt_connected":
          this.mqtt = data.value;
          break;
        default:
          // Not a sensor this card renders; ignore.
          break;
      }
  }

  private get _label(): string {
    if (this.device && !this.device.startsWith("#")) return this.device;
    return `Storage ${this.device.replace(/^#/, "") || "?"}`;
  }

  @state() sunlightStatus?: string;
  @state() pv1Active?: boolean;
  @state() pv2Active?: boolean;
  @state() pv1Power?: number;
  @state() pv2Power?: number;
  @state() outputPower1?: number;
  @state() outputPower2?: number;
  @state() outputTotal?: number;
  @state() outputEnabled1?: boolean;
  @state() outputEnabled2?: boolean;
  @state() toggleOutput1?: () => void;
  @state() toggleOutput2?: () => void;
  @state() batteryPercentage?: number;
  @state() energyStored?: number;
  @state() dod?: number;
  @state() dodMin?: number;
  @state() dodMax?: number;
  @state() dodModalOpen: boolean = false;
  @state() setDoD?: (dod: number) => void;
  @state() dischargeThreshold?: number;
  @state() dischargeThresholdMin?: number;
  @state() dischargeThresholdMax?: number;
  @state() dischargeThresholdModalOpen: boolean = false;
  @state() setDischargeThreshold?: (threshold: number) => void;
  @state() lastUpdate?: string;
  @state() temperature1?: number;
  @state() temperature2?: number;
  @state() deviceGeneration?: string;
  @state() deviceName?: string;
  @state() deviceType?: string;
  @state() deviceId?: string;
  @state() mac?: string;
  @state() bluetooth?: boolean;
  @state() wifi?: boolean;
  @state() mqtt?: boolean;

  @state() deviceInfoToShow: "deviceName" | "deviceType" | "deviceId" | "mac" = "deviceName";

  static styles = [
    cssTab,
    css`
      :host {
        display: block;
        max-width: 450px;
        margin: 0 auto;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }
      :host {
        max-width: 100%;
        padding: 10px;
      }
      /* Collapse storages that have not reported any data yet. */
      :host(:not([active])) {
        display: none;
      }

      .tab-container {
        padding: 10px;
      }

      :host > .battery-container {
        max-width: 200px;
        margin: 10px auto;
      }

      .status-bar {
        display: flex;
        justify-content: center;
      }

      @media (min-width: 768px) {
        :host {
          max-width: 450px;
          padding: 20px;
        }
      }

      .battery {
        width: 90px;
        height: 140px;
        padding: 10px;
        border-radius: 20px;
        position: relative;
        margin: 75px auto 20px;
      }

      .battery::before {
        content: " ";
        height: 15px;
        width: 90px;
        background: #333;
        display: block;
        position: absolute;
        top: -25px;
        border-radius: 20px 20px 0 0;
      }

      .battery::after {
        content: " ";
        display: block;
        position: absolute;
        top: -5px;
        left: -5px;
        right: -5px;
        bottom: -5px;
        border: 5px solid #333;
        border-radius: 10px;
      }

      .battery::after[color-scheme="dark"] {
        border-color: #fff;
      }

      .battery-level {
        background: #30b455;
        position: absolute;
        bottom: 0px;
        left: 0;
        right: 0;
        transition: height 0.3s ease-out;
      }
      .battery-level.warn {
        background-color: #efaf13;
      }

      .battery-level.alert {
        background-color: #e81309 !important;
      }

      .battery-level.alert::before {
        background-image: url("data:image/svg+xml;charset=US-ASCII,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22utf-8%22%3F%3E%3C!DOCTYPE%20svg%20PUBLIC%20%22-%2F%2FW3C%2F%2FDTD%20SVG%201.1%2F%2FEN%22%20%22http%3A%2F%2Fwww.w3.org%2FGraphics%2FSVG%2F1.1%2FDTD%2Fsvg11.dtd%22%3E%3Csvg%20version%3D%221.1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cg%3E%3C%2Fg%3E%20%3Cpath%20fill%3D%22%23e81309%22%20d%3D%22M17.927%2012l2.68-10.28c0.040-0.126%200.060-0.261%200.060-0.4%200-0.726-0.587-1.32-1.314-1.32-0.413%200-0.78%200.187-1.019%200.487l-13.38%2017.353c-0.18%200.227-0.287%200.513-0.287%200.827%200%200.733%200.6%201.333%201.333%201.333h8.073l-2.68%2010.28c-0.041%200.127-0.060%200.261-0.060%200.4%200.001%200.727%200.587%201.32%201.314%201.32%200.413%200%200.78-0.186%201.020-0.487l13.379-17.353c0.181-0.227%200.287-0.513%200.287-0.827%200-0.733-0.6-1.333-1.333-1.333h-8.073z%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E");
        background-repeat: no-repeat;
        height: 90px;
        width: 90px;
        margin: -50px 0 0 40px;
        content: "";
        display: inline-block;
        position: absolute;
      }

      .bluetooth-x {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M188.8 169.6L133.33 128l23.47-17.6a8 8 0 0 0-9.6-12.8L128 112V48l19.2 14.4a8 8 0 1 0 9.6-12.8l-32-24A8 8 0 0 0 112 32v80L60.8 73.6a8 8 0 0 0-9.6 12.8l55.47 41.6l-55.47 41.6a8 8 0 1 0 9.6 12.8L112 144v80a8 8 0 0 0 12.8 6.4l64-48a8 8 0 0 0 0-12.8M128 208v-64l42.67 32ZM237.66 98.34a8 8 0 0 1-11.32 11.32L208 91.31l-18.34 18.35a8 8 0 0 1-11.32-11.32L196.69 80l-18.35-18.34a8 8 0 0 1 11.32-11.32L208 68.69l18.34-18.35a8 8 0 0 1 11.32 11.32L219.31 80Z'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .bluetooth {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M188.8 169.6L133.33 128l55.47-41.6a8 8 0 0 0 0-12.8l-64-48A8 8 0 0 0 112 32v80L60.8 73.6a8 8 0 0 0-9.6 12.8l55.47 41.6l-55.47 41.6a8 8 0 1 0 9.6 12.8L112 144v80a8 8 0 0 0 12.8 6.4l64-48a8 8 0 0 0 0-12.8M128 48l42.67 32L128 112Zm0 160v-64l42.67 32Z'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .wifi-x {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M229.66 98.34a8 8 0 0 1-11.32 11.32L200 91.31l-18.34 18.35a8 8 0 0 1-11.32-11.32L188.69 80l-18.35-18.34a8 8 0 0 1 11.32-11.32L200 68.69l18.34-18.35a8 8 0 0 1 11.32 11.32L211.31 80ZM128 192a12 12 0 1 0 12 12a12 12 0 0 0-12-12m44.71-33.47a76.05 76.05 0 0 0-89.42 0a8 8 0 0 0 9.42 12.94a60 60 0 0 1 70.58 0a8 8 0 1 0 9.42-12.94m-29.48-93.8a8 8 0 1 0 1.54-15.92c-5.53-.54-11.18-.81-16.77-.81A172.35 172.35 0 0 0 18.92 87a8 8 0 1 0 10.16 12.37A156.25 156.25 0 0 1 128 64c5.08 0 10.2.25 15.23.73m-.32 48.27a8 8 0 0 0 2.18-15.85A124.75 124.75 0 0 0 128 96a122.74 122.74 0 0 0-77 26.77A8 8 0 0 0 56 137a7.93 7.93 0 0 0 5-1.73A106.87 106.87 0 0 1 128 112a109 109 0 0 1 14.91 1'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .wifi {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M140 204a12 12 0 1 1-12-12a12 12 0 0 1 12 12m97.08-117a172 172 0 0 0-218.16 0a8 8 0 0 0 10.16 12.37a156 156 0 0 1 197.84 0A8 8 0 0 0 237.08 87M205 122.77a124 124 0 0 0-153.94 0A8 8 0 0 0 61 135.31a108 108 0 0 1 134.06 0a8 8 0 0 0 11.24-1.3a8 8 0 0 0-1.3-11.24m-32.26 35.76a76.05 76.05 0 0 0-89.42 0a8 8 0 0 0 9.42 12.94a60 60 0 0 1 70.58 0a8 8 0 1 0 9.42-12.94'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .cloud-x {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M160 40a88.09 88.09 0 0 0-78.71 48.67A64 64 0 1 0 72 216h88a88 88 0 0 0 0-176m0 160H72a48 48 0 0 1 0-96c1.1 0 2.2 0 3.29.11A88 88 0 0 0 72 128a8 8 0 0 0 16 0a72 72 0 1 1 72 72m29.66-82.34L171.31 136l18.35 18.34a8 8 0 0 1-11.32 11.32L160 147.31l-18.34 18.35a8 8 0 0 1-11.32-11.32L148.69 136l-18.35-18.34a8 8 0 0 1 11.32-11.32L160 124.69l18.34-18.35a8 8 0 0 1 11.32 11.32'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .cloud {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23000' d='M160 40a88.09 88.09 0 0 0-78.71 48.67A64 64 0 1 0 72 216h88a88 88 0 0 0 0-176m0 160H72a48 48 0 0 1 0-96c1.1 0 2.2 0 3.29.11A88 88 0 0 0 72 128a8 8 0 0 0 16 0a72 72 0 1 1 72 72'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .mqtt {
        display: inline-block;
        width: 1em;
        height: 1em;
        --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M10.657 23.994h-9.45A1.212 1.212 0 0 1 0 22.788v-9.18h.071c5.784 0 10.504 4.65 10.586 10.386m7.606 0h-4.045C14.135 16.246 7.795 9.977 0 9.942V6.038h.071c9.983 0 18.121 8.044 18.192 17.956m4.53 0h-.97C21.754 12.071 11.995 2.407 0 2.372v-1.16C0 .55.544.006 1.207.006h7.64C15.733 2.49 21.257 7.789 24 14.508v8.291c0 .663-.544 1.195-1.207 1.195M16.713.006h6.092A1.19 1.19 0 0 1 24 1.2v5.914c-.91-1.242-2.046-2.65-3.158-3.762C19.588 2.11 18.122.987 16.714.005Z'/%3E%3C/svg%3E");
        background-color: currentColor;
        -webkit-mask-image: var(--svg);
        mask-image: var(--svg);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .battery-text-container {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 2;
      }

      .energy-stored {
        position: relative;
        font-size: 18px;
        z-index: 2;
      }

      .info {
        text-align: center;
        margin-bottom: 20px;
      }

      .info div {
        font-size: 18px;
        margin-bottom: 8px;
      }

      .button {
        display: inline-block;
        padding: 10px 20px;
        background-color: #1c1c1e;
        border: 1px solid #5f5f5f;
        border-radius: 14px;
        color: white;
        font-size: 18px;
        text-align: center;
        margin-bottom: 10px;
        text-decoration: none;
        cursor: pointer;
        transition: background-color 0.3s;
        margin: 0 10px;
      }

      .button.active {
        background-color: #007aff;
      }

      .button:disabled {
        background-color: #5f5f5f;
        cursor: not-allowed;
      }

      .button:active {
        background-color: #0a0a0a;
      }

      .update {
        font-size: 14px;
        text-align: center;
      }

      .info-bar {
        display: flex;
        justify-content: center;
        margin-bottom: 20px;
      }
    `,
  ];

  _handleOutput1(e: any) {
    if (!e?.ctrlKey) e.stopPropagation();
    if (this.toggleOutput1) {
      this.toggleOutput1();
    }
  }

  _handleOutput2(e: any) {
    if (!e?.ctrlKey) e.stopPropagation();
    if (this.toggleOutput2) {
      this.toggleOutput2();
    }
  }

  _toggleDeviceInfo(e: any) {
    switch (this.deviceInfoToShow) {
      case "deviceName":
        this.deviceInfoToShow = "deviceType";
        break;
      case "deviceType":
        this.deviceInfoToShow = "deviceId";
        break;
      case "deviceId":
        this.deviceInfoToShow = "mac";
        break;
      case "mac":
        this.deviceInfoToShow = "deviceType";
        break;
      default:
        this.deviceInfoToShow = "deviceType";
    }
  }

  _handleChangeDoD(e: any) {
    this.dodModalOpen = false;
    this.setDoD(e.detail);
  }

  _handleChangeDischargeThreshold(e: any) {
    this.dischargeThresholdModalOpen = false;
    this.setDischargeThreshold(e.detail);
  }

  _bluetoothIcon() {
    return html`<span class="bluetooth"></span>`;
  }

  _wifiIcon() {
    return html`<span class="wifi"></span>`;
  }

  _mqttIcon() {
    return html`<span class="cloud"></span>`;
  }

  render() {
    if (this.deviceType == null) {
      return;
    }
    const batteryHeight = `${this.batteryPercentage ?? 0}%`;
    let out1 = `${this.outputPower1 ?? "-"}W`;
    let out2 = `${this.outputPower2 ?? "-"}W`;
    const deviceInfo = this[this.deviceInfoToShow];
    return html`
      <div class="tab-header">${this._label}</div>
      <div class="tab-container">
        <div class="info" @click=${this._toggleDeviceInfo}>
          <div>${deviceInfo ? deviceInfo : ""}</div>
          ${this.bluetooth ? this._bluetoothIcon() : ""}
          ${this.wifi ? this._wifiIcon() : ""}
          ${this.mqtt ? this._mqttIcon() : ""}
        </div>
        <div class="status-bar">
          <wattage-status-box
            label="🔽 In1"
            .active=${this.pv1Active}
            .interactive=${false}
            >${this.pv1Power != null
              ? `${this.pv1Power}W`
              : "-"}</wattage-status-box
          >
          <wattage-status-box
            label="🔽 In2"
            .active=${this.pv2Active}
            .interactive=${false}
            >${this.pv2Power != null
              ? `${this.pv2Power}W`
              : "-"}</wattage-status-box
          >
          ${this.deviceGeneration === "1" ? html`
          <wattage-status-box
            label="🔼 Out1"
            .active=${this.outputEnabled1}
            .interactive=${true}
            @box-click=${this._handleOutput1}
            >${this.outputPower1 != null
              ? `${this.outputPower1}W`
              : "-"}</wattage-status-box
          >
          <wattage-status-box
            label="🔼 Out2"
            .active=${this.outputEnabled2}
            .interactive=${true}
            @box-click=${this._handleOutput2}
            >${this.outputPower2 != null
              ? `${this.outputPower2}W`
              : "-"}</wattage-status-box
          >` : html`
            <wattage-status-box
              label="🔼 Out"
              .active=${this.outputEnabled1 || this.outputEnabled2}
              .interactive=${false}
            >${this.outputTotal != null
              ? `${this.outputTotal}W`
              : "-"}</wattage-status-box
            >`}
        </div>
        <div class="battery">
          <div
            class="battery-level ${this.batteryPercentage != null &&
            this.dod != null &&
            this.batteryPercentage <= 100 - this.dod
              ? "alert"
              : ""}"
            style="height: ${batteryHeight};"
          ></div>
          <div class="battery-text-container">
            <span class="battery-percentage"
              >${this.batteryPercentage != null
                ? `${this.batteryPercentage}%`
                : ""}</span
            >
            <div class="energy-stored">
              ${this.energyStored != null ? `${this.energyStored}Wh` : ""}
            </div>
          </div>
        </div>
        <div class="info-bar">
          <wattage-status-box
            @box-click=${() => (this.dodModalOpen = true)}
            label="🪫 DoD"
            .interactive=${true}
            .active=${false}
          >
            ${this.dod ?? "-"}%
          </wattage-status-box>
          ${this.deviceGeneration != null && this.deviceGeneration == "1" ? html` 
          <wattage-status-box
            label="🔋 Threshold"
            
            .interactive=${true}
            .active=${false}
            @box-click=${() => {
              this.dischargeThresholdModalOpen = true;
            }}
          >
            ${this.dischargeThreshold ?? "-"}W
          </wattage-status-box>
          ` : ""}
          <wattage-status-box
            label="🌡️ Temp"
            .interactive=${false}
            .active=${false}
            >${this.temperature1 ?? "-"}°C</wattage-status-box
          >
        </div>
        <div class="update">⏳ Last Update: ${this.lastUpdate ?? "-"}</div>
      </div>

      <input-modal
        .isOpen=${this.dischargeThresholdModalOpen}
        value=${this.dischargeThreshold}
        title="Discharge Threshold"
        min=${this.dischargeThresholdMin}
        max=${this.dischargeThresholdMax}
        @submit=${this._handleChangeDischargeThreshold}
        @close=${() => (this.dischargeThresholdModalOpen = false)}
      ></input-modal>
      <input-modal
        .isOpen=${this.dodModalOpen}
        value=${this.dod}
        title="DoD"
        min=${this.dodMin}
        max=${this.dodMax}
        @submit=${this._handleChangeDoD}
        @close=${() => (this.dodModalOpen = false)}
      ></input-modal>
    `;
  }
}

// Discovers B2500 storages from the state stream and lays them out in a
// responsive grid. The container owns all storage state: it subscribes once (so
// it never misses the initial burst of states) and hands each card a map of its
// entities. Cards are therefore purely presentational and can be created lazily
// as devices are discovered without missing any data. Devices are keyed by their
// ESPHome sub-device, so this works with both legacy and simplified entity names.
@customElement("solar-storage-dashboard")
export class SolarStorageDashboard extends LitElement {
  // device -> (sensor key -> parsed entity). Insertion order = discovery order.
  @state() private _devices: Map<string, Map<string, ParsedEntity>> = new Map();
  // Set once the state stream has gone quiet without a single entity parsing;
  // see _armIdleCheck.
  @state() private _unrecognized = false;

  private _eventsSeen = 0;
  private _idleTimer?: ReturnType<typeof setTimeout>;

  // How long after the first state event to conclude that nothing in the stream
  // is recognizable. ESPHome sends every entity at once when /events is opened,
  // so anything this dashboard understands has arrived well inside this window.
  static GRACE_MS = 3000;

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 450px));
      justify-content: center;
      gap: 16px;
      margin: 8px 0;
    }
    @media (max-width: 700px) {
      :host {
        grid-template-columns: 1fr;
      }
    }
    .unrecognized {
      grid-column: 1 / -1;
      padding: 8px 12px;
      border: 1px solid currentColor;
      border-radius: 4px;
      opacity: 0.7;
      font-size: 0.9em;
      text-align: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.source?.addEventListener("state", this._onState);
  }

  disconnectedCallback() {
    window.source?.removeEventListener("state", this._onState);
    if (this._idleTimer) clearTimeout(this._idleTimer);
    super.disconnectedCallback();
  }

  // An empty dashboard has two very different causes: no storage has reported
  // yet, or the event format changed under us and nothing parses at all (as when
  // ESPHome 2026.8 dropped `name_id`). The second one used to be invisible --
  // the graph simply vanished -- so say it out loud. Armed once, by the first
  // state event, and never rearmed: a stream of unparseable events must not keep
  // pushing the verdict out of reach.
  private _armGraceTimer() {
    if (this._idleTimer !== undefined) return;
    this._idleTimer = setTimeout(() => {
      if (this._devices.size > 0) return;
      this._unrecognized = true;
      console.warn(
        `[b2500] no storage entities recognized in ${this._eventsSeen} state ` +
          `events -- the ESPHome event format may have changed. Please report ` +
          `this at https://github.com/tomquist/esphome-b2500/issues`
      );
    }, SolarStorageDashboard.GRACE_MS);
  }

  private _onState = (e: Event) => {
    let data: any;
    try {
      data = JSON.parse((e as MessageEvent).data);
    } catch {
      return;
    }
    this._eventsSeen++;
    this._armGraceTimer();
    const p = parseStorageEntity(data);
    if (!p || !KNOWN_STORAGE_KEYS.has(p.key)) return;

    let entities = this._devices.get(p.device);
    if (!entities) {
      if (this._devices.size >= MAX_STORAGES) return;
      entities = new Map();
      this._devices.set(p.device, entities);
    }
    entities.set(p.key, p);
    // Hand the card a fresh Map instance so Lit sees the property change.
    this._devices.set(p.device, new Map(entities));
    this._devices = new Map(this._devices);
  };

  render() {
    if (this._devices.size === 0) {
      return this._unrecognized
        ? html`<div class="unrecognized">
            No B2500 storage recognized in ${this._eventsSeen} entity updates.
            The web UI may not match this ESPHome version -- please
            <a href="https://github.com/tomquist/esphome-b2500/issues"
              >report it</a
            >.
          </div>`
        : html``;
    }
    return html`${[...this._devices.entries()].map(
      ([device, entities]) =>
        html`<solar-storage-ui
          .device=${device}
          .entities=${entities}
        ></solar-storage-ui>`
    )}`;
  }
}

export function getBasePath() {
  let str = window.location.pathname;
  return str.endsWith("/") ? str.slice(0, -1) : str;
}

// `actionBase` is the entity path relative to the base path (e.g.
// "number/My%20Store/Depth%20of%20Discharge" or the legacy
// "switch/b2500_-_1_-_store__out_1_-_active"). `action` is the trailing verb,
// optionally with a query string (e.g. "turn_on" or "set?value=80").
function doAction(actionBase: string, action: string) {
  fetch(`${getBasePath()}/${actionBase}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "true",
  }).then((r) => {
    console.log(r);
  });
}
