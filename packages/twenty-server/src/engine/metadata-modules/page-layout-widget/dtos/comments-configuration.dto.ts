import { Field, ObjectType } from '@nestjs/graphql';

import { IsIn, IsNotEmpty } from 'class-validator';
import { type CommentsConfiguration } from 'twenty-shared/types';

import { WidgetConfigurationType } from 'src/engine/metadata-modules/page-layout-widget/enums/widget-configuration-type.type';

@ObjectType('CommentsConfiguration')
export class CommentsConfigurationDTO implements CommentsConfiguration {
  @Field(() => WidgetConfigurationType)
  @IsIn([WidgetConfigurationType.COMMENTS])
  @IsNotEmpty()
  configurationType: WidgetConfigurationType.COMMENTS;
}
