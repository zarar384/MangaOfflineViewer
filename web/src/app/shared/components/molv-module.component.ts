import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { MolvSwitchComponent } from "./molv-switch/molv-switch.component";
import { MolvSliderComponent } from "./molv-slider/molv-slider.component";
import { MolvDropdownComponent } from "./molv-dropdown/molv-dropdown.component";
import { MolvTextboxComponent } from "./molv-textbox/molv-textbox";
import { FormsModule } from "@angular/forms";

@NgModule({
  declarations: [MolvSwitchComponent, MolvSliderComponent, MolvDropdownComponent],
  exports: [MolvSwitchComponent, MolvSliderComponent, MolvDropdownComponent, MolvTextboxComponent ],
  imports: [CommonModule, MolvTextboxComponent, FormsModule ]
})
export class MolvModule { }