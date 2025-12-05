import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { MolvSwitchComponent } from "./molv-switch/molv-switch.component";
import { MolvSliderComponent } from "./molv-slider/molv-slider.component";
import { MolvDropdownComponent } from "./molv-dropdown/molv-dropdown.component";

@NgModule({
  declarations: [MolvSwitchComponent, MolvSliderComponent, MolvDropdownComponent],
  exports: [MolvSwitchComponent, MolvSliderComponent, MolvDropdownComponent],
  imports: [CommonModule]
})
export class MolvModule { }