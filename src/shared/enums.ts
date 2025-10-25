export enum Models {
  Category = "CATEGORY",
  Exercise = "EXERCISE",
  AdminUser = "USER",
  Template = "TEMPLATE",
  TemplateExercises = "TEMPLATE-EXERCISES",
  UserDetails = "USER-DETAILS",
  ExerciseVariables = "EXERCISE-VARIABLES",
}

export const Tables: Record<Models, string> = {
  [Models.Category]: "categories",
  [Models.Exercise]: "exercises",
  [Models.AdminUser]: "users",
  [Models.Template]: "templates",
  [Models.TemplateExercises]: "template_exercises",
  [Models.UserDetails]: "user_details",
  [Models.ExerciseVariables]: "exercise_variables",
};

export enum Errors {
  NotExist = "NOT_EXIST",
  NotOwner = "NOT_OWNER",
}
