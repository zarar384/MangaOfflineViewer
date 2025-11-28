import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { MolvSwitchComponent } from "./molv-switch/molv-switch.component";
import { MolvSliderComponent } from "./molv-slider/molv-slider.component";

@NgModule({
  declarations: [MolvSwitchComponent, MolvSliderComponent],
  exports: [MolvSwitchComponent, MolvSliderComponent],
  imports: [CommonModule]
})
export class MolvModule { }