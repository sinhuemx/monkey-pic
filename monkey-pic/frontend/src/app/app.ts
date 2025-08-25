import { Component } from '@angular/core';
import { ConverterComponent } from './converter/converter';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ConverterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
