import { css } from "lit";

export default css`
  :host {
    position: relative;
  }
  select {
    width: 100%;
    border-radius: 4px;
  }
  input[type="range"],
  input[type="text"] {
    width: calc(100% - 3rem);
    height: 0.75rem;
  }
  .range {
    text-align: center;
  }
  .entity-row {
    display: flex;
    align-items: center;
    flex-direction: row;
    transition: all 0.3s ease-out 0s;
    min-height: 40px;
    position: relative;
  }
  .entity-row.expanded {
    min-height: 240px;
  }
  .entity-row:nth-child(2n) {
    background-color: rgba(90, 90, 90, 0.1);
  }
  .entity-row iconify-icon {
    vertical-align: middle;
  }
  .entity-row > :nth-child(1) {
    flex: 0 0 40px;
    color: #44739e;
    line-height: 40px;
    text-align: center;
  }
  /* The name takes whatever the value column does not need, so it only gets
     ellipsized once the row is genuinely too narrow (issue #308). min-width: 0
     keeps it shrinkable below its content width - without it a flex item
     refuses to shrink and the ellipsis never kicks in. */
  .entity-row > :nth-child(2) {
    flex: 1 1 auto;
    margin-left: 16px;
    margin-right: 8px;
    text-wrap: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  /* A read-only value ("61 %") is sized by its text, so a short state no
     longer reserves half the row while the name next to it is cut off. */
  .entity-row > :nth-child(3) {
    flex: 0 1 auto;
    min-width: 0;
    margin-right: 8px;
    margin-left: 20px;
    text-align: right;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  /* Rows whose control is a slider, dropdown or text field still need room for
     it: grow into free space up to 45% of the row, never below 150px, and give
     space up faster than the name when the row is too narrow for both. Same
     specificity as the rule above, so it has to stay after it. */
  .entity-row > .wide-control {
    flex: 1 4 auto;
    min-width: 150px;
    max-width: 45%;
  }
  .entity-row > :nth-child(3) > :only-child {
    margin-left: auto;
  }
  .binary_sensor_off {
    color: rgba(127, 127, 127, 0.7);
  }
  .singlebutton-row button {
    margin: auto;
    display: flex;
  }
  .climate-wrap{
    width: 100%;
    margin: 10px 0 10px 0;
  }
  .climate-row {
    width: 100%;
    display: inline-flex;
    flex-wrap: wrap;
    text-align: left;
  }
  .climate-row > select{
    width: 50%;
  }
  .climate-row > label{
    align-content: center;
    width: 150px;
  }
    
  input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0 !important;
  }
`;
